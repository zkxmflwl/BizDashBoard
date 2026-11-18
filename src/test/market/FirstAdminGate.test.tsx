import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const FIRST_ADMIN = "aaaaaaaa-0000-0000-0000-000000000001";
const SECOND_ADMIN = "bbbbbbbb-0000-0000-0000-000000000002";

const state = vi.hoisted(() => ({
  auth: {} as Record<string, unknown>,
  queries: [] as [string, unknown][][],
  sessionId: "session-1",
  sessionReads: 0,
}));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => state.auth }));
vi.mock("@/components/PasswordChangeModal", () => ({ default: () => null }));
vi.mock("@/integrations/supabase/client", () => {
  // dash_users 조회 체인을 흉내 낸다. 어떤 조건으로 조회했는지 기록한다.
  const builder = () => {
    const calls: [string, unknown][] = [];
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "order", "limit"]) {
      chain[method] = (...args: unknown[]) => {
        calls.push([method, args]);
        return chain;
      };
    }
    chain.maybeSingle = async () => {
      state.queries.push(calls);
      return { data: { auth_user_id: "aaaaaaaa-0000-0000-0000-000000000001" }, error: null };
    };
    return chain;
  };
  // 로그인 세션마다 다른 session_id가 들어 있는 access token을 흉내 낸다.
  const getSession = async () => {
    state.sessionReads += 1;
    const payload = btoa(JSON.stringify({ session_id: state.sessionId }));
    return { data: { session: { access_token: `header.${payload}.signature` } } };
  };
  return { supabase: { from: () => builder(), auth: { getSession } } };
});

import AppLayout from "@/components/AppLayout";
import { FirstAdminLanding, FirstAdminOnly } from "@/components/market/FirstAdminGate";

function signIn(uid: string, role: "ADMIN" | "MANAGER", sessionId = "session-1", lastSignInAt = "2026-11-18T00:00:00Z") {
  state.sessionId = sessionId;
  state.auth = {
    authUser: { id: uid, last_sign_in_at: lastSignInAt },
    dashUser: { auth_user_id: uid, user_name: "테스트", role_code: role, is_active: true, feature_access: [] },
    logout: vi.fn(),
    hasPermission: (required: string) => role === "ADMIN" || required !== "ADMIN",
    hasFeature: () => role === "ADMIN",
  };
}

function renderApp(initialPath: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route
            path="/"
            element={
              <FirstAdminLanding>
                <p>대시보드 화면</p>
              </FirstAdminLanding>
            }
          />
          <Route
            path="/market-test"
            element={
              <FirstAdminOnly>
                <p>경제지표 화면</p>
                <Link to="/">대시보드로</Link>
              </FirstAdminOnly>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  window.sessionStorage.clear();
  state.queries.length = 0;
  state.sessionReads = 0;
});

describe("최초관리자 전용 화면", () => {
  it("최초관리자는 로그인 후 첫 진입 때 경제지표 화면으로 이동하고, 그 뒤에는 대시보드를 열 수 있다", async () => {
    signIn(FIRST_ADMIN, "ADMIN");
    const view = renderApp("/");
    expect(await screen.findByText("경제지표 화면")).toBeInTheDocument();

    fireEvent.click(screen.getByText("대시보드로"));
    expect(await screen.findByText("대시보드 화면")).toBeInTheDocument();

    // 다시 로그인하면(새 세션) 다시 첫 화면으로 보낸다.
    view.unmount();
    signIn(FIRST_ADMIN, "ADMIN", "session-2");
    renderApp("/");
    expect(await screen.findByText("경제지표 화면")).toBeInTheDocument();
  });

  it("같은 로그인 세션에서는 last_sign_in_at이 바뀌어도 대시보드에서 다시 이동시키지 않는다", async () => {
    signIn(FIRST_ADMIN, "ADMIN");
    const view = renderApp("/");
    await screen.findByText("경제지표 화면");

    // 다른 기기에서 로그인해 last_sign_in_at만 바뀐 상황
    view.unmount();
    signIn(FIRST_ADMIN, "ADMIN", "session-1", "2026-11-19T09:00:00Z");
    renderApp("/");
    expect(await screen.findByText("대시보드 화면")).toBeInTheDocument();
    expect(screen.queryByText("경제지표 화면")).not.toBeInTheDocument();
  });

  it("최초관리자는 활성 ADMIN 중 생성일이 가장 이른 계정으로 조회한다", async () => {
    signIn(FIRST_ADMIN, "ADMIN");
    renderApp("/market-test");
    await screen.findByText("경제지표 화면");

    expect(state.queries[0]).toEqual([
      ["select", ["auth_user_id"]],
      ["eq", ["role_code", "ADMIN"]],
      ["eq", ["is_active", true]],
      ["order", ["created_at", { ascending: true }]],
      ["order", ["auth_user_id", { ascending: true }]],
      ["limit", [1]],
    ]);
  });

  it("다른 관리자는 경제지표 화면에 들어갈 수 없고 첫 화면도 대시보드다", async () => {
    signIn(SECOND_ADMIN, "ADMIN");
    renderApp("/market-test");
    expect(await screen.findByText("대시보드 화면")).toBeInTheDocument();
    expect(screen.queryByText("경제지표 화면")).not.toBeInTheDocument();
  });

  it("관리자가 아니면 조회 없이 바로 대시보드를 보여 준다", async () => {
    signIn("cccccccc-0000-0000-0000-000000000003", "MANAGER");
    renderApp("/");
    expect(screen.getByText("대시보드 화면")).toBeInTheDocument();
    expect(state.queries).toHaveLength(0);
    expect(state.sessionReads).toBe(0);
  });
});

describe("사이드 메뉴", () => {
  function renderLayout() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: 0 } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <AppLayout>
            <p>내용</p>
          </AppLayout>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it("최초관리자에게는 경제지표·뉴스가 메뉴 맨 위에 보인다", async () => {
    signIn(FIRST_ADMIN, "ADMIN");
    renderLayout();

    const link = await screen.findByRole("link", { name: "경제지표·뉴스" });
    expect(link).toHaveAttribute("href", "/market-test");
    expect(screen.getAllByRole("link")[0]).toBe(link);
    expect(screen.getAllByRole("link")[1]).toHaveTextContent("대시보드");
  });

  it("다른 사용자에게는 메뉴가 보이지 않는다", async () => {
    signIn(SECOND_ADMIN, "ADMIN");
    renderLayout();
    await waitFor(() => expect(state.queries).toHaveLength(1));
    expect(screen.queryByRole("link", { name: "경제지표·뉴스" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("link")[0]).toHaveTextContent("대시보드");
  });
});
