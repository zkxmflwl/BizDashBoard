import { useEffect, useState, type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { MARKET_TEST_PATH } from "@/config/marketConfig";
import { useAuth } from "@/contexts/AuthContext";
import { useIsFirstAdmin } from "@/hooks/useIsFirstAdmin";
import { supabase } from "@/integrations/supabase/client";

const LANDED_KEY = "market-test:landed";

/** sessionStorage를 쓸 수 없는 환경을 위한 보조 저장 */
let landedInMemory: string | null = null;

function readLanded(): string | null {
  try {
    return window.sessionStorage.getItem(LANDED_KEY) ?? landedInMemory;
  } catch {
    return landedInMemory;
  }
}

function writeLanded(value: string): void {
  landedInMemory = value;
  try {
    window.sessionStorage.setItem(LANDED_KEY, value);
  } catch {
    // 저장하지 못해도 메모리 값으로 같은 탭 안에서는 다시 이동하지 않는다.
  }
}

/**
 * access token에 들어 있는 session_id를 읽는다.
 * 로그인할 때마다 새로 발급되고, 토큰 갱신이나 다른 기기에서의 로그인으로는 바뀌지 않는다.
 */
function sessionIdOf(accessToken: string | undefined): string | null {
  try {
    const payload = accessToken?.split(".")[1];
    if (!payload) return null;
    const claims = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as { session_id?: unknown };
    return typeof claims.session_id === "string" ? claims.session_id : null;
  } catch {
    return null;
  }
}

function Spinner() {
  return (
    <div className="flex h-64 items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}

/** 최초관리자에게만 내용을 보여 준다. 그 외 사용자는 대시보드로 돌려보낸다 */
export function FirstAdminOnly({ children }: { children: ReactNode }) {
  const { isFirstAdmin, isLoading } = useIsFirstAdmin();
  if (isLoading) return <Spinner />;
  if (!isFirstAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
}

/**
 * 최초관리자가 로그인한 뒤 처음 "/"에 들어오면 경제지표 화면으로 보낸다.
 * 한 번 보낸 뒤에는 같은 로그인 세션 동안 다시 보내지 않으므로 메뉴에서 대시보드를 열 수 있다.
 * 다시 로그인하면 세션이 바뀌므로 다시 첫 화면으로 보낸다. 다른 사용자에게는 아무 영향이 없다.
 */
export function FirstAdminLanding({ children }: { children: ReactNode }) {
  const { authUser } = useAuth();
  const { isFirstAdmin, isLoading } = useIsFirstAdmin();
  const userId = authUser?.id ?? null;
  const [resolved, setResolved] = useState<{ userId: string; key: string } | null>(null);

  useEffect(() => {
    if (!isFirstAdmin || !userId) return;
    let alive = true;
    const done = (sessionId: string | null) => {
      if (alive) setResolved({ userId, key: `${userId}:${sessionId ?? ""}` });
    };
    supabase.auth.getSession().then(
      ({ data }) => done(sessionIdOf(data.session?.access_token)),
      () => done(null),
    );
    return () => {
      alive = false;
    };
  }, [isFirstAdmin, userId]);

  const loginKey = resolved && resolved.userId === userId ? resolved.key : null;
  const shouldRedirect = isFirstAdmin && loginKey !== null && readLanded() !== loginKey;

  useEffect(() => {
    if (shouldRedirect && loginKey !== null) writeLanded(loginKey);
  }, [shouldRedirect, loginKey]);

  // 최초관리자는 세션 확인이 끝날 때까지 대시보드를 그리지 않는다(잠깐 보였다가 이동하는 것을 막는다).
  if (isLoading || (isFirstAdmin && loginKey === null)) return <Spinner />;
  if (shouldRedirect) return <Navigate to={MARKET_TEST_PATH} replace />;
  return <>{children}</>;
}
