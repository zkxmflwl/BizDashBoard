import { NavLink } from '@/components/NavLink';
import { useAuth } from '@/contexts/AuthContext';
import {
  LayoutDashboard,
  Monitor,
  Cloud,
  BarChart3,
  LogOut,
  Menu,
  X,
  Shield,
  UserCog,
  Building2,
  FolderKanban,
  FileText,
  Briefcase,
  Eye,
  ChevronDown,
  ChevronRight,
  Handshake,
} from 'lucide-react';
import { useState } from 'react';
import PasswordChangeModal from '@/components/PasswordChangeModal';

type NavItem = {
  title: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
};

const dashboardItem: NavItem = {
  title: '대시보드',
  url: '/dashboard',
  icon: LayoutDashboard,
};

const businessNavItems: NavItem[] = [
  { title: '영업 현황', url: '/sales-overview', icon: Handshake },
  { title: '월간 보고', url: '/department-report', icon: FileText },
  { title: '월별 데이터', url: '/DepartmentMonthlyData', icon: BarChart3 },
  { title: '프로젝트 데이터', url: '/projects', icon: FolderKanban },
];

const strategyNavItems: NavItem[] = [
  { title: '부문 프로젝트 현황', url: '/sector-projects-view', icon: Eye },
  { title: '부문 프로젝트 관리', url: '/sector-projects', icon: Briefcase },
];

const generalAffairsNavItems: NavItem[] = [
  { title: 'IT 유형자산 관리', url: '/it-tangible', icon: Monitor },
  { title: 'IT 무형자산 관리', url: '/it-intangible', icon: Cloud },
];

const adminNavItems: NavItem[] = [
  { title: '부서 관리', url: '/admin/departments', icon: Building2 },
  { title: '사용자 관리', url: '/admin/users', icon: UserCog },
];

const roleLabel: Record<string, string> = {
  ADMIN: '관리자',
  MANAGER: '매니저',
  VIEWER: '뷰어',
};

type GroupKey = 'business' | 'strategy' | 'general' | 'admin';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { dashUser, logout, hasPermission } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<GroupKey, boolean>>({
    business: true,
    strategy: true,
    general: true,
    admin: true,
  });

  const toggleGroup = (group: GroupKey) => {
    setOpenGroups((prev) => ({
      ...prev,
      [group]: !prev[group],
    }));
  };

  const renderNavItem = (item: NavItem, isChild = false) => (
    <NavLink
      key={item.url}
      to={item.url}
      end={item.url === '/'}
      className={`flex items-center gap-3 rounded-lg py-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-all ${
        isChild ? 'px-3 ml-3' : 'px-3'
      }`}
      activeClassName="bg-primary/10 text-primary font-medium"
    >
      <item.icon className="h-5 w-5 shrink-0" />
      {!collapsed && <span>{item.title}</span>}
    </NavLink>
  );

  const renderGroup = (
    groupKey: GroupKey,
    title: string,
    items: NavItem[],
    adminOnly = false
  ) => {
    if (adminOnly && !hasPermission('ADMIN')) return null;

    const isOpen = openGroups[groupKey];

    return (
      <div className="space-y-1">
        <button
          type="button"
          onClick={() => toggleGroup(groupKey)}
          className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs font-semibold tracking-wider text-muted-foreground/80 hover:bg-muted transition-colors"
        >
          <div className="flex items-center gap-2">
            {!collapsed &&
              (isOpen ? (
                <ChevronDown className="h-4 w-4 shrink-0" />
              ) : (
                <ChevronRight className="h-4 w-4 shrink-0" />
              ))}
            {!collapsed && <span>{title}</span>}
          </div>
          {collapsed &&
            (isOpen ? (
              <ChevronDown className="h-4 w-4 shrink-0" />
            ) : (
              <ChevronRight className="h-4 w-4 shrink-0" />
            ))}
        </button>

        {isOpen && (
          <div className="space-y-1">
            {items.map((item) => renderNavItem(item, true))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex min-h-screen w-full bg-background">
      <PasswordChangeModal />

      <aside
        className={`fixed left-0 top-0 z-40 h-screen flex flex-col border-r border-border bg-card transition-all duration-300 ${
          collapsed ? 'w-16' : 'w-60'
        }`}
      >
        <div className="flex h-16 items-center justify-between border-b border-border px-4">
          {!collapsed && (
            <span className="text-gradient text-lg font-bold tracking-tight">
              BizDashboard
            </span>
          )}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            {collapsed ? <Menu className="h-5 w-5" /> : <X className="h-5 w-5" />}
          </button>
        </div>

        <nav className="flex-1 space-y-2 px-2 py-4 overflow-y-auto">
          {renderNavItem(dashboardItem)}
          {renderGroup('business', '사업부', businessNavItems)}
          {renderGroup('strategy', '전략', strategyNavItems)}
          {renderGroup('general', '총무', generalAffairsNavItems)}
          {renderGroup('admin', '관리자 전용', adminNavItems, true)}
        </nav>

        {dashUser && (
          <div className="border-t border-border p-3">
            {!collapsed && (
              <div className="mb-2">
                <p className="text-sm font-medium text-foreground">{dashUser.user_name}</p>
                <div className="mt-1 flex items-center gap-1.5">
                  <Shield className="h-3 w-3 text-primary" />
                  <span className="text-xs text-primary">
                    {roleLabel[dashUser.role_code] || dashUser.role_code}
                  </span>
                </div>
              </div>
            )}
            <button
              onClick={logout}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
            >
              <LogOut className="h-4 w-4" />
              {!collapsed && <span>로그아웃</span>}
            </button>
          </div>
        )}
      </aside>

      <main
        className={`flex-1 transition-all duration-300 ${
          collapsed ? 'ml-16' : 'ml-60'
        }`}
      >
        <div className="p-6 lg:p-8">{children}</div>
      </main>
    </div>
  );
}
