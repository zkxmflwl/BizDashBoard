import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { MARKET_TEST_PATH } from "@/config/marketConfig";
import { useIsFirstAdmin } from "@/hooks/useIsFirstAdmin";

function Spinner() {
  return (
    <div className="flex h-64 items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}

/** 최초관리자에게만 내용을 보여 준다. 그 외 사용자는 첫 화면으로 돌려보낸다 */
export function FirstAdminOnly({ children }: { children: ReactNode }) {
  const { isFirstAdmin, isLoading } = useIsFirstAdmin();
  if (isLoading) return <Spinner />;
  if (!isFirstAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
}

/**
 * 첫 화면("/") 분기에 끼워 넣는다.
 * 최초관리자는 경제지표 화면으로 보내고, 그 외 사용자는 children(기본 첫 화면 분기)을 그대로 따른다.
 * "/"는 이동 전용 주소이므로 최초관리자도 메뉴에서 대시보드(/dashboard)를 그대로 열 수 있다.
 */
export function FirstAdminHome({ children }: { children: ReactNode }) {
  const { isFirstAdmin, isLoading } = useIsFirstAdmin();
  if (isLoading) return <Spinner />;
  if (isFirstAdmin) return <Navigate to={MARKET_TEST_PATH} replace />;
  return <>{children}</>;
}
