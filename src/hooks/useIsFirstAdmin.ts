import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

/**
 * 최초관리자 여부.
 * 최초관리자는 dash_users에서 활성 상태인 ADMIN 가운데 created_at이 가장 이른 계정으로 정의한다.
 * ADMIN이 아닌 사용자는 조회하지 않고 바로 false를 돌려준다.
 */
export function useIsFirstAdmin(): { isFirstAdmin: boolean; isLoading: boolean } {
  const { dashUser } = useAuth();
  const isAdmin = !!dashUser && dashUser.is_active && dashUser.role_code === "ADMIN";

  const { data: firstAdminId, isLoading } = useQuery({
    queryKey: ["first-admin-id"],
    enabled: isAdmin,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dash_users")
        .select("auth_user_id")
        .eq("role_code", "ADMIN")
        .eq("is_active", true)
        .order("created_at", { ascending: true })
        .order("auth_user_id", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data?.auth_user_id ?? null;
    },
  });

  return {
    isFirstAdmin: isAdmin && !!firstAdminId && firstAdminId === dashUser.auth_user_id,
    isLoading: isAdmin && isLoading,
  };
}
