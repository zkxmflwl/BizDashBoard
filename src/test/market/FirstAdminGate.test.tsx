import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const FIRST_ADMIN = "aaaaaaaa-0000-0000-0000-000000000001";
const SECOND_ADMIN = "bbbbbbbb-0000-0000-0000-000000000002";

const state = vi.hoisted(() => ({
  auth: {} as Record<string, unknown>,
  queries: [] as [string, unknown][][],
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
  return { supabase: { from: () => builder() } };
});

import AppLayout from "@/components/AppLayout";
import { FirstAdminHome, FirstAdminOnly } from "@/components/market/FirstAdminGate";

function signIn(uid: string, role: "ADMIN" | "MANAGER") {
  state.auth = {
    authUser: { id: uid },
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
              <FirstAdminHome>
                <p>기본 첫 화면 분기</p>
              </FirstAdminHome>
            }
          />
          <Route
            path="/market-test"
            element={
              <FirstAdminOnly>
                <p>경제지표 화면</p>
                <Link to="/dashboard">대시보드로</Link>
              </FirstAdminOnly>
            }
          />
          <Route path="/dashboard" element={<p>대시보드 화면</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.queries.length = 0;
});

describe("최초관리자 전용 화면", () => {
  it("최초관리자의 첫 화면은 경제지표이고, 메뉴에서 대시보드를 그대로 열 수 있다", async () => {
    signIn(FIRST_ADMIN, "ADMIN");
    renderApp("/");
    expect(await screen.findByText("경제지표 화면")).toBeInTheDocument();
    expect(screen.queryByText("기본 첫 화면 분기")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("대시보드로"));
    expect(await screen.findByText("대시보드 화면")).toBeInTheDocument();
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

  it("다른 관리자는 경제지표 화면에 들어갈 수 없고 기본 첫 화면 분기를 따른다", async () => {
    signIn(SECOND_ADMIN, "ADMIN");
    renderApp("/market-test");
    expect(await screen.findByText("기본 첫 화면 분기")).toBeInTheDocument();
    expect(screen.queryByText("경제지표 화면")).not.toBeInTheDocument();
  });

  it("관리자가 아니면 조회 없이 바로 기본 첫 화면 분기를 따른다", async () => {
    signIn("cccccccc-0000-0000-0000-000000000003", "MANAGER");
    renderApp("/");
    expect(screen.getByText("기본 첫 화면 분기")).toBeInTheDocument();
    expect(state.queries).toHaveLength(0);
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
    expect(screen.getAllByRole("link")[1]).toHaveAttribute("href", "/dashboard");
  });

  it("다른 사용자에게는 메뉴가 보이지 않는다", async () => {
    signIn(SECOND_ADMIN, "ADMIN");
    renderLayout();
    await waitFor(() => expect(state.queries).toHaveLength(1));
    expect(screen.queryByRole("link", { name: "경제지표·뉴스" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("link")[0]).toHaveTextContent("대시보드");
  });
});
