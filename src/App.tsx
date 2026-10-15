import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, RouterProvider, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import AppLayout from "@/components/AppLayout";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import ITTangibleAssets from "./pages/ITTangibleAssets";
import ITIntangibleAssets from "./pages/ITIntangibleAssets";
import DepartmentMonthlyData from "./pages/DepartmentMonthlyData";
import DepartmentManage from "./pages/DepartmentManage";
import DepartmentMonthlyReport from "./pages/DepartmentMonthlyReport";
import ProjectManage from "./pages/ProjectManage";
import SectorProjectManage from "./pages/SectorProjectManage";
import SectorProjectView from "./pages/SectorProjectView";
import AdminUsers from "./pages/AdminUsers";
import SalesOverview from "./pages/SalesOverview";
import NotFound from "./pages/NotFound";
import { Loader2 } from "lucide-react";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 30 * 1000,
    },
  },
});

function FullPageSpinner() {
  return (
    <div className="flex h-screen items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}

function ProtectedRoute({
  children,
  adminOnly = false,
  feature,
}: {
  children: React.ReactNode;
  adminOnly?: boolean;
  /** feature_access에 이 값이 있거나 ADMIN일 때만 접근 허용 */
  feature?: string;
}) {
  const { authUser, dashUser, isLoggedIn, isLoading, logout, hasFeature } = useAuth();

  if (isLoading) return <FullPageSpinner />;

  if (!authUser) return <Navigate to="/login" replace />;

  if (!dashUser || !dashUser.is_active) {
    return (
      <div className="flex h-screen items-center justify-center px-4">
        <div className="glass-card rounded-2xl p-8 max-w-md text-center">
          <h2 className="text-xl font-semibold text-foreground mb-2">접근 불가</h2>
          <p className="text-sm text-muted-foreground mb-4">
            {!dashUser
              ? "등록되지 않은 사용자입니다. 관리자에게 문의하세요."
              : "비활성화된 계정입니다. 관리자에게 문의하세요."}
          </p>
          <button
            onClick={() => void logout()}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            로그아웃
          </button>
        </div>
      </div>
    );
  }

  if (!isLoggedIn) return <Navigate to="/login" replace />;

  if (adminOnly && dashUser.role_code !== "ADMIN") {
    return <Navigate to="/" replace />;
  }

  if (feature && !hasFeature(feature)) {
    return <Navigate to="/" replace />;
  }

  return <AppLayout>{children}</AppLayout>;
}

function AuthRoute({ children }: { children: React.ReactNode }) {
  const { isLoggedIn, isLoading } = useAuth();

  if (isLoading) return <FullPageSpinner />;

  if (isLoggedIn) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

const router = createBrowserRouter([
  {
    path: "/login",
    element: (
      <AuthRoute>
        <Login />
      </AuthRoute>
    ),
  },
  {
    path: "/",
    element: (
      <ProtectedRoute>
        <Dashboard />
      </ProtectedRoute>
    ),
  },
  {
    path: "/it-tangible",
    element: (
      <ProtectedRoute>
        <ITTangibleAssets />
      </ProtectedRoute>
    ),
  },
  {
    path: "/it-intangible",
    element: (
      <ProtectedRoute>
        <ITIntangibleAssets />
      </ProtectedRoute>
    ),
  },
  {
    path: "/projects",
    element: (
      <ProtectedRoute>
        <ProjectManage />
      </ProtectedRoute>
    ),
  },
  {
    path: "/sector-projects",
    element: (
      <ProtectedRoute>
        <SectorProjectManage />
      </ProtectedRoute>
    ),
  },
  {
    path: "/sector-projects-view",
    element: (
      <ProtectedRoute>
        <SectorProjectView />
      </ProtectedRoute>
    ),
  },
  {
    path: "/DepartmentMonthlyData",
    element: (
      <ProtectedRoute>
        <DepartmentMonthlyData />
      </ProtectedRoute>
    ),
  },
  {
    path: "/sales-overview",
    element: (
      <ProtectedRoute>
        <SalesOverview />
      </ProtectedRoute>
    ),
  },
  {
    path: "/department-report",
    element: (
      <ProtectedRoute>
        <DepartmentMonthlyReport />
      </ProtectedRoute>
    ),
  },
  {
    path: "/admin/departments",
    element: (
      <ProtectedRoute adminOnly>
        <DepartmentManage />
      </ProtectedRoute>
    ),
  },
  {
    path: "/admin/users",
    element: (
      <ProtectedRoute adminOnly>
        <AdminUsers />
      </ProtectedRoute>
    ),
  },
  {
    path: "*",
    element: <NotFound />,
  },
]);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
