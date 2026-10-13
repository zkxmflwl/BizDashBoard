import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
  useCallback,
  useRef,
  useMemo,
} from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User as AuthUser } from "@supabase/supabase-js";

export type RoleCode = "ADMIN" | "MANAGER" | "VIEWER";

export interface DashUser {
  auth_user_id: string;
  user_email: string;
  user_name: string;
  role_code: RoleCode;
  department_code: string | null;
  is_active: boolean;
  must_change_password: boolean;
  /** 열람 허용된 제한 부서 코드 (예: ['KSPI']) */
  restricted_dept_codes: string[];
  /** 접근 허용된 화면 기능 (예: ['sales_overview']). ADMIN은 전부 허용 */
  feature_access: string[];
}

interface AuthContextType {
  authUser: AuthUser | null;
  dashUser: DashUser | null;
  isLoggedIn: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<string | null>;
  logout: () => Promise<void>;
  hasPermission: (required: RoleCode) => boolean;
  /** 화면 기능 접근 여부. ADMIN은 항상 true */
  hasFeature: (feature: string) => boolean;
  refreshDashUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const roleLevel: Record<RoleCode, number> = {
  VIEWER: 1,
  MANAGER: 2,
  ADMIN: 3,
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [dashUser, setDashUser] = useState<DashUser | null>(null);

  // 최초 앱 진입 시에만 전역 스피너 사용
  const [isLoading, setIsLoading] = useState(true);

  const mountedRef = useRef(false);

  // 초기 부트스트랩 완료 여부
  const bootstrappedRef = useRef(false);

  // login() 호출 직후 SIGNED_IN 흐름인지 표시
  const loginInProgressRef = useRef(false);

  // 최신 사용자 id 추적
  const currentUserIdRef = useRef<string | null>(null);

  // dash_user fetch 경쟁 상태 방지용 request id
  const fetchSeqRef = useRef(0);

  const fetchDashUser = useCallback(async (uid: string): Promise<DashUser | null> => {
    try {
      const { data, error } = await supabase
        .from("dash_users")
        .select("*")
        .eq("auth_user_id", uid)
        .maybeSingle();

      if (error) throw error;
      return (data as DashUser | null) ?? null;
    } catch (err) {
      console.error("fetchDashUser error:", err);
      return null;
    }
  }, []);

  /**
   * dashUser 동기화
   * - showGlobalLoading=true 인 경우에만 전역 스피너 사용
   * - 최신 요청만 반영
   */
  const syncDashUser = useCallback(
    async (user: AuthUser | null, showGlobalLoading = false) => {
      const requestId = ++fetchSeqRef.current;

      if (!mountedRef.current) return;

      if (!user) {
        currentUserIdRef.current = null;
        setAuthUser(null);
        setDashUser(null);
        if (showGlobalLoading && mountedRef.current) {
          setIsLoading(false);
        }
        return;
      }

      currentUserIdRef.current = user.id;
      setAuthUser(user);

      if (showGlobalLoading && mountedRef.current) {
        setIsLoading(true);
      }

      try {
        const du = await fetchDashUser(user.id);

        // 언마운트 되었거나 더 최신 요청이 있으면 무시
        if (!mountedRef.current || requestId !== fetchSeqRef.current) return;

        // 도중에 다른 사용자로 바뀌었으면 무시
        if (currentUserIdRef.current !== user.id) return;

        setDashUser(du);
      } finally {
        if (showGlobalLoading && mountedRef.current && requestId === fetchSeqRef.current) {
          setIsLoading(false);
        }
      }
    },
    [fetchDashUser]
  );

  // 최초 진입: 여기서만 전역 스피너를 책임짐
  useEffect(() => {
    mountedRef.current = true;

    const bootstrap = async () => {
      setIsLoading(true);

      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) {
          console.error("getSession error:", error);
        }

        if (!mountedRef.current) return;

        const user = data.session?.user ?? null;
        await syncDashUser(user, false);
      } finally {
        if (mountedRef.current) {
          bootstrappedRef.current = true;
          setIsLoading(false);
        }
      }
    };

    void bootstrap();

    return () => {
      mountedRef.current = false;
    };
  }, [syncDashUser]);

  // Auth 이벤트 처리
  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      // Supabase 권장: 콜백 안에서 바로 await 체인 길게 물지 않고 다음 tick에서 처리
      queueMicrotask(() => {
        if (!mountedRef.current) return;

        const user = session?.user ?? null;
        const nextUserId = user?.id ?? null;
        const prevUserId = currentUserIdRef.current;

        // 로그아웃
        if (event === "SIGNED_OUT") {
          currentUserIdRef.current = null;
          loginInProgressRef.current = false;
          setAuthUser(null);
          setDashUser(null);
          setIsLoading(false);
          return;
        }

        // 아직 bootstrap 전이면 여기서는 상태만 최소 반영
        // 실제 초기 로딩 종료는 bootstrap이 담당
        if (!bootstrappedRef.current) {
          if (user) {
            currentUserIdRef.current = user.id;
            setAuthUser(user);
          }
          return;
        }

        // 공통: authUser는 최신 반영
        setAuthUser(user);

        // INITIAL_SESSION:
        // 새로고침 직후 bootstrap과 겹칠 수 있으므로,
        // bootstrap 이후에는 userId가 바뀐 경우만 조용히 동기화
        if (event === "INITIAL_SESSION") {
          if (nextUserId !== prevUserId) {
            void syncDashUser(user, false);
          }
          return;
        }

        // SIGNED_IN:
        // 공식적으로 refocus 때도 다시 발생 가능하므로
        // "login() 직후" 또는 "다른 사용자로 바뀐 경우"만 특별 취급
        if (event === "SIGNED_IN") {
          const isRealLoginFlow = loginInProgressRef.current;
          const isDifferentUser = nextUserId !== prevUserId;

          loginInProgressRef.current = false;

          if (isRealLoginFlow) {
            void syncDashUser(user, true);
            return;
          }

          if (isDifferentUser) {
            void syncDashUser(user, false);
            return;
          }

          // 같은 유저의 재확인/재포커스는 무시
          return;
        }

        // USER_UPDATED는 조용히 동기화
        if (event === "USER_UPDATED") {
          void syncDashUser(user, false);
          return;
        }

        // TOKEN_REFRESHED:
        // 일반적으로 dash_users 재조회 필요 없음
        // 단, 현재 authUser만 맞춰주고 종료
        if (event === "TOKEN_REFRESHED") {
          return;
        }

        // 기타 예외 이벤트:
        // 유저가 바뀐 경우만 조용히 동기화
        if (nextUserId !== prevUserId) {
          void syncDashUser(user, false);
        }
      });
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [syncDashUser]);

  const login = async (email: string, password: string): Promise<string | null> => {
    try {
      loginInProgressRef.current = true;

      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        loginInProgressRef.current = false;
        setIsLoading(false);
        return error.message;
      }

      // 성공 시 실제 dashUser 동기화와 isLoading 해제는
      // onAuthStateChange(SIGNED_IN) -> syncDashUser(..., true)가 담당
      return null;
    } catch (err) {
      loginInProgressRef.current = false;
      setIsLoading(false);
      return err instanceof Error ? err.message : "로그인 중 오류가 발생했습니다.";
    }
  };

  const logout = async () => {
    try {
      setIsLoading(true);

      const { error } = await supabase.auth.signOut();
      if (error) {
        console.error("signOut error:", error);
      }
    } finally {
      loginInProgressRef.current = false;
      currentUserIdRef.current = null;
      setAuthUser(null);
      setDashUser(null);
      setIsLoading(false);
    }
  };

  const hasPermission = (required: RoleCode): boolean => {
    if (!dashUser) return false;
    return roleLevel[dashUser.role_code] >= roleLevel[required];
  };

  const hasFeature = (feature: string): boolean => {
    if (!dashUser) return false;
    if (dashUser.role_code === "ADMIN") return true;
    return (dashUser.feature_access ?? []).includes(feature);
  };

  const refreshDashUser = async () => {
    if (!authUser) return;
    await syncDashUser(authUser, false);
  };

  const isLoggedIn = useMemo(() => {
    return !!authUser && !!dashUser && dashUser.is_active;
  }, [authUser, dashUser]);

  const value = useMemo<AuthContextType>(
    () => ({
      authUser,
      dashUser,
      isLoggedIn,
      isLoading,
      login,
      logout,
      hasPermission,
      hasFeature,
      refreshDashUser,
    }),
    [authUser, dashUser, isLoggedIn, isLoading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
};
