import { Fragment, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList } from 'recharts';
import { fetchBusinessProjects, BusinessProjectRow } from '@/services/businessProjectService';
import { useDepartments } from '@/hooks/useDepartments';
import { formatDashboardAmount, formatKRWShort } from '@/data/mockData';
import {
  Loader2, Briefcase, Activity, Flag, AlertTriangle, TrendingUp, CalendarDays,
  ChevronDown, ChevronRight, ArrowUp, ArrowDown, ArrowUpDown, Search, X,
} from 'lucide-react';

/**
 * 영업 현황 (C레벨용 전사 조망)
 * - 접근: feature_access 'sales_overview' 보유자 또는 ADMIN (라우트에서 제어)
 * - 데이터: business_projects (is_active). 제한 부서 프로젝트는 RLS로 자동 제외됨
 * - 수주 실적: 수주 이후 단계(수주 완료·프로젝트 중·프로젝트 완료)를 수주일(order_date) 기준으로 집계.
 *   수주일이 없으면 시작일(start_date)로 대체하고 화면에 그 건수를 표시한다.
 *   금액은 해당 프로젝트의 등록 매출액 합계이며, 월별 발생 매출이나 수주잔고가 아니다.
 * - 영업 단계(기회 식별·영업 중)에는 예상 매출이 입력되지 않으므로 건수 중심으로 표시
 * - 화면 순서: 수주 요약 → 월별 추이·사업부 비교 → 영업 중인 건 → 확인 필요 → 전체 목록
 */

const PIPELINE = ['기회 식별', '영업 중', '수주 완료', '프로젝트 중', '프로젝트 완료'] as const;
const CLOSED = ['영업 종결', '기타'];
const ORDERED_STATUSES = [...PIPELINE, ...CLOSED];
const PIPELINE_LABEL: Record<string, string> = {
  '기회 식별': '기회 식별', '영업 중': '영업 중', '수주 완료': '착수 대기', '프로젝트 중': '수행 중', '프로젝트 완료': '완료',
};
/** 수주 이후 단계: 매출 금액이 확정되어 합산 가능 */
const AMOUNT_STATUSES = new Set(['수주 완료', '프로젝트 중', '프로젝트 완료']);
/** 영업 단계 */
const SELLING_STATUSES = new Set(['기회 식별', '영업 중']);

const STATUS_STYLE: Record<string, string> = {
  '기회 식별': 'bg-slate-100 text-slate-700',
  '영업 중': 'bg-blue-100 text-blue-700',
  '수주 완료': 'bg-violet-100 text-violet-700',
  '프로젝트 중': 'bg-emerald-100 text-emerald-700',
  '프로젝트 완료': 'bg-gray-100 text-gray-600',
  '영업 종결': 'bg-red-100 text-red-600',
  '기타': 'bg-amber-100 text-amber-700',
};

type QuickFilter =
  | '' | 'orderedThisYear' | 'orderedThisMonth' | 'completedThisYear' | 'needsCheck'
  | 'overdue' | 'statusDateMismatch' | 'noOrderDate' | 'noSalesNote' | 'ending30';
type SortDir = 'asc' | 'desc' | null;
type DeptSort = 'amount' | 'dept';

const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const addDays = (key: string, days: number) => {
  const d = new Date(key);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const daysUntil = (dateKey: string | null, today: string) => {
  if (!dateKey) return null;
  return Math.round((new Date(dateKey).getTime() - new Date(today).getTime()) / 86400000);
};
/** 기준월(YYYY-MM)로 끝나는 최근 n개월 키 */
const lastMonths = (monthKey: string, n: number) => {
  const [y, m] = monthKey.split('-').map(Number);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(y, m - 1 - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
};
/** 수주 집계 기준일: 수주일 우선, 없으면 시작일 */
const orderKey = (p: BusinessProjectRow) => p.order_date || p.start_date || null;
const fmt = (n: number) => formatDashboardAmount(n);
const sumAmount = (list: BusinessProjectRow[]) => list.reduce((a, p) => a + Number(p.sales_amount || 0), 0);

interface TrendPoint { ym: string; label: string; n: number; amt: number; fallback: number }

const TrendTooltip = ({ active, payload }: { active?: boolean; payload?: { payload: TrendPoint }[] }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-md">
      <p className="font-medium text-foreground">{d.ym}</p>
      <p className="mt-0.5 text-foreground">수주 {d.n}건 · {fmt(d.amt)}</p>
      {d.fallback > 0 && <p className="mt-0.5 text-muted-foreground">수주일 미입력 {d.fallback}건은 시작일 기준</p>}
    </div>
  );
};

interface DeptRow {
  code: string; monthN: number; monthAmt: number; yearN: number; yearAmt: number;
  opportunity: number; selling: number; waiting: number; ongoing: number; completedYear: number; needsCheck: number; total: number;
}
type DeptTotal = Omit<DeptRow, 'code'>;

export default function SalesOverview() {
  const { data: allProjects = [], isLoading } = useQuery({ queryKey: ['business-projects'], queryFn: fetchBusinessProjects });
  const { data: departments = [] } = useDepartments();

  const [selectedSector, setSelectedSector] = useState<string | null>(null);
  const [selectedDept, setSelectedDept] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [quick, setQuick] = useState<QuickFilter>('');
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);
  const [deptSort, setDeptSort] = useState<DeptSort>('amount');

  const today = todayKey();
  const thisYear = today.slice(0, 4);
  const thisMonth = today.slice(0, 7);
  const in30 = addDays(today, 30);

  const deptOrder = useMemo(() => new Map(departments.map((d, i) => [d.department_code, i])), [departments]);
  const deptName = (code: string) => departments.find(d => d.department_code === code)?.department_name || code;

  const sectors = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of departments) {
      if (d.sector_code && d.sector_name && !map.has(d.sector_code)) map.set(d.sector_code, d.sector_name);
    }
    return Array.from(map.entries()).map(([code, name]) => ({ code, name }));
  }, [departments]);

  const sectorDepts = useMemo(() => {
    if (!selectedSector) return null;
    return new Set(departments.filter(d => d.sector_code === selectedSector).map(d => d.department_code));
  }, [departments, selectedSector]);

  // 범위(부문·사업부) 필터: 모든 집계의 기준
  const scoped = useMemo(() => {
    return allProjects.filter(p => {
      if (!p.is_active) return false;
      if (sectorDepts && !sectorDepts.has(p.department_code)) return false;
      if (selectedDept && p.department_code !== selectedDept) return false;
      return true;
    });
  }, [allProjects, sectorDepts, selectedDept]);

  // 판정 조건
  const isOrdered = (p: BusinessProjectRow) => AMOUNT_STATUSES.has(p.project_status);
  const isSelling = (p: BusinessProjectRow) => SELLING_STATUSES.has(p.project_status);
  const isOrderedThisYear = (p: BusinessProjectRow) => isOrdered(p) && (orderKey(p) ?? '').startsWith(thisYear);
  const isOrderedThisMonth = (p: BusinessProjectRow) => isOrdered(p) && (orderKey(p) ?? '').startsWith(thisMonth);
  const isCompletedThisYear = (p: BusinessProjectRow) => p.project_status === '프로젝트 완료' && !!p.end_date && p.end_date.startsWith(thisYear);
  // 확인 필요: 날짜 비교만으로 지연·상태 미갱신을 확정할 수 없으므로 "확인 필요"로 표현한다
  const isOverdue = (p: BusinessProjectRow) => p.project_status === '프로젝트 중' && !!p.end_date && p.end_date < today;
  const isStatusDateMismatch = (p: BusinessProjectRow) => p.project_status === '프로젝트 완료' && !!p.end_date && p.end_date > today;
  const isNoOrderDate = (p: BusinessProjectRow) => isOrdered(p) && !p.order_date;
  const isNoSalesNote = (p: BusinessProjectRow) => isSelling(p) && !(p.sales_schedule_note || '').trim();
  const isEnding30 = (p: BusinessProjectRow) => p.project_status === '프로젝트 중' && !!p.end_date && p.end_date >= today && p.end_date <= in30;
  const isNeedsCheck = (p: BusinessProjectRow) => isOverdue(p) || isStatusDateMismatch(p) || isNoOrderDate(p) || isNoSalesNote(p);

  const CHECKS: { key: QuickFilter; label: string; desc: string; test: (p: BusinessProjectRow) => boolean; warn: boolean }[] = [
    { key: 'overdue', label: '종료일 경과', desc: '수행 중인데 종료일이 지남. 지연인지 상태 미갱신인지 확인', test: isOverdue, warn: true },
    { key: 'statusDateMismatch', label: '완료 상태·종료일 불일치', desc: '완료 상태인데 종료일이 미래 날짜', test: isStatusDateMismatch, warn: true },
    { key: 'noOrderDate', label: '수주일 미입력', desc: '수주 이후 단계인데 수주일이 없음. 수주 실적은 시작일로 집계됨', test: isNoOrderDate, warn: true },
    { key: 'noSalesNote', label: '영업 진행사항 미입력', desc: '영업 단계인데 진행사항 메모가 없음', test: isNoSalesNote, warn: true },
    { key: 'ending30', label: '30일 내 종료 예정', desc: '수행 중이며 종료일이 30일 이내', test: isEnding30, warn: false },
  ];

  const quickTest: Record<Exclude<QuickFilter, ''>, (p: BusinessProjectRow) => boolean> = {
    orderedThisYear: isOrderedThisYear,
    orderedThisMonth: isOrderedThisMonth,
    completedThisYear: isCompletedThisYear,
    needsCheck: isNeedsCheck,
    overdue: isOverdue,
    statusDateMismatch: isStatusDateMismatch,
    noOrderDate: isNoOrderDate,
    noSalesNote: isNoSalesNote,
    ending30: isEnding30,
  };

  // KPI (수주 실적 중심)
  const kpi = useMemo(() => {
    const by = (s: string) => scoped.filter(p => p.project_status === s);
    const orderedYear = scoped.filter(isOrderedThisYear);
    const orderedMonth = scoped.filter(isOrderedThisMonth);
    const ongoing = by('프로젝트 중');
    const completed = scoped.filter(isCompletedThisYear);
    return {
      orderedYear: orderedYear.length,
      orderedYearAmount: sumAmount(orderedYear),
      orderedYearFallback: orderedYear.filter(p => !p.order_date).length,
      orderedMonth: orderedMonth.length,
      orderedMonthAmount: sumAmount(orderedMonth),
      opportunity: by('기회 식별').length,
      selling: by('영업 중').length,
      ongoing: ongoing.length,
      ongoingAmount: sumAmount(ongoing),
      completed: completed.length,
      completedAmount: sumAmount(completed),
      needsCheck: scoped.filter(isNeedsCheck).length,
      checks: CHECKS.map(c => ({ ...c, n: scoped.filter(c.test).length })),
      pipeline: PIPELINE.map(s => ({ status: s, count: by(s).length })),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoped, today]);

  // 최근 12개월 수주 추이 (수주일 기준, 없으면 시작일)
  const trend = useMemo<TrendPoint[]>(() => {
    const months = lastMonths(thisMonth, 12);
    const map = new Map<string, TrendPoint>(months.map(m => [m, { ym: m, label: `${m.slice(2, 4)}.${m.slice(5)}`, n: 0, amt: 0, fallback: 0 }]));
    for (const p of scoped) {
      if (!isOrdered(p)) continue;
      const k = orderKey(p);
      const row = k ? map.get(k.slice(0, 7)) : undefined;
      if (!row) continue;
      row.n += 1;
      row.amt += Number(p.sales_amount || 0);
      if (!p.order_date) row.fallback += 1;
    }
    return months.map(m => map.get(m)!);
  }, [scoped, thisMonth]);

  // 사업부별 실적 비교
  const deptRows = useMemo(() => {
    const rows = new Map<string, DeptRow>();
    for (const p of scoped) {
      if (!rows.has(p.department_code)) {
        rows.set(p.department_code, { code: p.department_code, monthN: 0, monthAmt: 0, yearN: 0, yearAmt: 0, opportunity: 0, selling: 0, waiting: 0, ongoing: 0, completedYear: 0, needsCheck: 0, total: 0 });
      }
      const r = rows.get(p.department_code)!;
      const amt = Number(p.sales_amount || 0);
      r.total += 1;
      if (isOrderedThisMonth(p)) { r.monthN += 1; r.monthAmt += amt; }
      if (isOrderedThisYear(p)) { r.yearN += 1; r.yearAmt += amt; }
      if (p.project_status === '기회 식별') r.opportunity += 1;
      if (p.project_status === '영업 중') r.selling += 1;
      if (p.project_status === '수주 완료') r.waiting += 1;
      if (p.project_status === '프로젝트 중') r.ongoing += 1;
      if (isCompletedThisYear(p)) r.completedYear += 1;
      if (isNeedsCheck(p)) r.needsCheck += 1;
    }
    const list = Array.from(rows.values());
    if (deptSort === 'amount') list.sort((a, b) => b.yearAmt - a.yearAmt || b.yearN - a.yearN || (deptOrder.get(a.code) ?? 999) - (deptOrder.get(b.code) ?? 999));
    else list.sort((a, b) => (deptOrder.get(a.code) ?? 999) - (deptOrder.get(b.code) ?? 999));
    const total: DeptTotal = { monthN: 0, monthAmt: 0, yearN: 0, yearAmt: 0, opportunity: 0, selling: 0, waiting: 0, ongoing: 0, completedYear: 0, needsCheck: 0, total: 0 };
    for (const r of list) {
      for (const k of Object.keys(total) as (keyof DeptTotal)[]) total[k] += r[k];
    }
    return { list, total };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoped, deptOrder, deptSort, today]);

  const statusRank = (s: string) => { const i = (ORDERED_STATUSES as readonly string[]).indexOf(s); return i < 0 ? 99 : i; };

  // 현재 영업 중인 건 (기회 식별·영업 중): 단계 순 → 기회식별일 오래된 순
  const sellingList = useMemo(() => scoped.filter(isSelling).sort((a, b) =>
    statusRank(a.project_status) - statusRank(b.project_status)
    || String(a.base_date ?? '9999').localeCompare(String(b.base_date ?? '9999'))
    || (deptOrder.get(a.department_code) ?? 999) - (deptOrder.get(b.department_code) ?? 999)
  ), [scoped, deptOrder]);

  // 목록 (상태·빠른 필터·검색 적용)
  const listed = useMemo(() => {
    let list = scoped.filter(p => {
      if (statusFilter && p.project_status !== statusFilter) return false;
      if (quick && !quickTest[quick](p)) return false;
      if (search) {
        const s = search.toLowerCase();
        const hay = [p.client_name, p.project_name, p.project_summary, p.category, p.sales_schedule_note, p.note].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
    if (sortKey && sortDir) {
      const key = sortKey as keyof BusinessProjectRow;
      list = [...list].sort((a, b) => {
        const av = a[key], bv = b[key];
        let cmp: number;
        if (sortKey === 'project_status') cmp = statusRank(String(av)) - statusRank(String(bv));
        else if (sortKey === 'department_code') cmp = (deptOrder.get(String(av)) ?? 999) - (deptOrder.get(String(bv)) ?? 999);
        else if (typeof av === 'number' || typeof bv === 'number') cmp = Number(av || 0) - Number(bv || 0);
        else cmp = String(av ?? '').localeCompare(String(bv ?? ''), 'ko', { numeric: true });
        return sortDir === 'asc' ? cmp : -cmp;
      });
    } else {
      // 기본: 단계 순 → 종료일 빠른 순
      list = [...list].sort((a, b) => statusRank(a.project_status) - statusRank(b.project_status) || String(a.end_date ?? '9999').localeCompare(String(b.end_date ?? '9999')));
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoped, statusFilter, quick, search, sortKey, sortDir, deptOrder, today]);

  const handleSort = (key: string) => {
    if (sortKey !== key) { setSortKey(key); setSortDir('asc'); }
    else if (sortDir === 'asc') setSortDir('desc');
    else { setSortKey(null); setSortDir(null); }
  };
  const SortIcon = ({ colKey }: { colKey: string }) => {
    if (sortKey === colKey) return sortDir === 'asc' ? <ArrowUp className="h-3 w-3 text-primary" /> : <ArrowDown className="h-3 w-3 text-primary" />;
    return <ArrowUpDown className="h-3 w-3 opacity-30" />;
  };

  /** 지표 클릭: 같은 조건을 다시 누르면 해제 */
  const applyQuick = (q: QuickFilter, status = '') => {
    const same = quick === q && statusFilter === status;
    setQuick(same ? '' : q);
    setStatusFilter(same ? '' : status);
  };
  const clearFilters = () => { setStatusFilter(''); setQuick(''); setSearch(''); };
  const quickLabel: Record<Exclude<QuickFilter, ''>, string> = {
    orderedThisYear: `${thisYear}년 누적 수주`,
    orderedThisMonth: '이번 달 수주',
    completedThisYear: `${thisYear}년 완료`,
    needsCheck: '확인 필요 전체',
    overdue: '종료일 경과',
    statusDateMismatch: '완료 상태·종료일 불일치',
    noOrderDate: '수주일 미입력',
    noSalesNote: '영업 진행사항 미입력',
    ending30: '30일 내 종료 예정',
  };

  const columns = [
    { key: 'department_code', label: '사업부' },
    { key: 'client_name', label: '고객사' },
    { key: 'project_name', label: '프로젝트명' },
    { key: 'project_status', label: '상태' },
    { key: 'category', label: '분류' },
    { key: 'order_date', label: '수주일' },
    { key: 'start_date', label: '기간' },
    { key: 'end_date', label: '잔여일' },
    { key: 'sales_amount', label: '매출' },
    { key: 'purchase_amount', label: '매입' },
    { key: 'sales_schedule_note', label: '영업 진행사항' },
  ];

  if (isLoading) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  const KpiCard = ({ title, value, sub, icon, active, onClick, tone = '' }: {
    title: string; value: string; sub?: string; icon: React.ReactNode; active?: boolean; onClick?: () => void; tone?: string;
  }) => (
    <button type="button" onClick={onClick}
      className={`glass-card rounded-xl p-4 text-left transition-all hover:ring-1 hover:ring-primary/40 ${active ? 'ring-2 ring-primary' : ''}`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-muted-foreground">{title}</p>
          <p className={`mt-1 text-xl font-bold ${tone || 'text-foreground'}`}>{value}</p>
          {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
        </div>
        <div className="rounded-lg bg-primary/10 p-2 text-primary">{icon}</div>
      </div>
    </button>
  );

  const trendMax = Math.max(0, ...trend.map(t => t.amt));
  const cell = (n: number) => n === 0 ? <span className="text-muted-foreground/50">-</span> : `${n}건`;
  const amtCell = (n: number, amt: number) => n === 0 ? <span className="text-muted-foreground/50">-</span> : (
    <>{n}건<span className="ml-1 text-[10px] text-muted-foreground">{fmt(amt)}</span></>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">영업 현황</h1>
          <p className="mt-1 text-sm text-muted-foreground">전사 수주 실적과 영업 진행 상태 (기준일 {today})</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">사업부</span>
          <select value={selectedDept} onChange={(e) => setSelectedDept(e.target.value)}
            className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none">
            <option value="">전체</option>
            {departments
              .filter(d => !sectorDepts || sectorDepts.has(d.department_code))
              .map(d => <option key={d.department_code} value={d.department_code}>{d.department_name}</option>)}
          </select>
        </div>
      </div>

      {/* 부문 탭 */}
      {sectors.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 rounded-lg border border-border bg-card p-1">
          <button onClick={() => { setSelectedSector(null); setSelectedDept(''); }}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${selectedSector === null ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}>
            전체
          </button>
          {sectors.map(s => (
            <button key={s.code} onClick={() => { setSelectedSector(s.code); setSelectedDept(''); }}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${selectedSector === s.code ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}>
              {s.name}
            </button>
          ))}
        </div>
      )}

      {/* 1. 수주 요약: 클릭하면 하단 목록이 해당 조건으로 필터됨 */}
      <div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <KpiCard title={`${thisYear}년 누적 수주`} value={`${kpi.orderedYear}건`}
            sub={`${fmt(kpi.orderedYearAmount)}${kpi.orderedYearFallback > 0 ? ` · 시작일 대체 ${kpi.orderedYearFallback}건` : ''}`}
            icon={<TrendingUp className="h-4 w-4" />} active={quick === 'orderedThisYear'} onClick={() => applyQuick('orderedThisYear')} />
          <KpiCard title={`이번 달 수주 (${Number(thisMonth.slice(5))}월)`} value={`${kpi.orderedMonth}건`} sub={fmt(kpi.orderedMonthAmount)}
            icon={<CalendarDays className="h-4 w-4" />} active={quick === 'orderedThisMonth'} onClick={() => applyQuick('orderedThisMonth')} />
          <KpiCard title="영업 중" value={`${kpi.selling}건`} sub={`기회 식별 ${kpi.opportunity}건`}
            icon={<Briefcase className="h-4 w-4" />} active={statusFilter === '영업 중' && !quick} onClick={() => applyQuick('', '영업 중')} />
          <KpiCard title="프로젝트 수행 중" value={`${kpi.ongoing}건`} sub={fmt(kpi.ongoingAmount)}
            icon={<Activity className="h-4 w-4" />} active={statusFilter === '프로젝트 중' && !quick} onClick={() => applyQuick('', '프로젝트 중')} />
          <KpiCard title={`${thisYear}년 완료`} value={`${kpi.completed}건`} sub={fmt(kpi.completedAmount)}
            icon={<Flag className="h-4 w-4" />} active={quick === 'completedThisYear'} onClick={() => applyQuick('completedThisYear')} />
          <KpiCard title="확인 필요" value={`${kpi.needsCheck}건`} tone={kpi.needsCheck > 0 ? 'text-red-600' : ''} sub="아래 '확인 필요 사항' 참고"
            icon={<AlertTriangle className="h-4 w-4" />} active={quick === 'needsCheck'} onClick={() => applyQuick('needsCheck')} />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          수주는 수주일 기준으로 집계하며, 수주일이 없는 건은 시작일로 대체합니다. 금액은 해당 수주 프로젝트에 등록된 매출액 합계입니다 (단위: 원).
        </p>
      </div>

      {/* 2. 최근 12개월 수주 추이 */}
      <div className="glass-card rounded-xl p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-foreground">최근 12개월 수주 추이</h2>
          <span className="text-xs text-muted-foreground">막대: 등록 매출액 합계 · 숫자: 수주 건수</span>
        </div>
        {trendMax === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">최근 12개월에 수주 건이 없습니다.</p>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={trend} margin={{ top: 18, right: 12, left: 4, bottom: 0 }} barCategoryGap="30%">
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickFormatter={(v: number) => formatKRWShort(v)} width={64} axisLine={false} tickLine={false} />
              <Tooltip content={<TrendTooltip />} cursor={{ fill: 'hsl(var(--muted))', opacity: 0.4 }} />
              <Bar dataKey="amt" fill="#7DA6FF" radius={[4, 4, 0, 0]} maxBarSize={44}>
                <LabelList dataKey="n" position="top" formatter={(v: number) => (v > 0 ? `${v}건` : '')} style={{ fontSize: 11, fill: 'hsl(var(--foreground))' }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* 3. 사업부별 실적 비교 */}
      <div className="glass-card rounded-xl p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-foreground">사업부별 실적</h2>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">정렬</span>
            <div className="flex rounded-lg border border-border p-0.5">
              {([['amount', '수주 규모순'], ['dept', '사업부 순']] as [DeptSort, string][]).map(([k, label]) => (
                <button key={k} onClick={() => setDeptSort(k)}
                  className={`rounded-md px-2.5 py-1 transition-colors ${deptSort === k ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted">
                <th className="px-3 py-2 text-left font-semibold text-foreground">사업부</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-semibold text-foreground">이번 달 수주</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-semibold text-foreground">{thisYear}년 누적 수주</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-semibold text-foreground">기회 식별</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-semibold text-foreground">영업 중</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-semibold text-foreground">착수 대기</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-semibold text-foreground">수행 중</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-semibold text-foreground">{thisYear}년 완료</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-semibold text-foreground">확인 필요</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-semibold text-foreground">전체</th>
              </tr>
            </thead>
            <tbody>
              {deptRows.list.length === 0 ? (
                <tr><td colSpan={10} className="py-6 text-center text-muted-foreground">데이터 없음</td></tr>
              ) : (
                <>
                  {deptRows.list.map(r => (
                    <tr key={r.code} onClick={() => setSelectedDept(prev => prev === r.code ? '' : r.code)}
                      className={`cursor-pointer border-b border-border/50 hover:bg-muted/30 ${selectedDept === r.code ? 'bg-primary/5' : ''}`}>
                      <td className="whitespace-nowrap px-3 py-2 font-medium text-foreground">{deptName(r.code)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right text-foreground">{amtCell(r.monthN, r.monthAmt)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right text-foreground">{amtCell(r.yearN, r.yearAmt)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right text-foreground">{cell(r.opportunity)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right text-foreground">{cell(r.selling)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right text-foreground">{cell(r.waiting)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right text-foreground">{cell(r.ongoing)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right text-foreground">{cell(r.completedYear)}</td>
                      <td className={`whitespace-nowrap px-3 py-2 text-right ${r.needsCheck > 0 ? 'font-medium text-red-600' : ''}`}>{cell(r.needsCheck)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-medium text-foreground">{r.total}건</td>
                    </tr>
                  ))}
                  <tr className="border-t border-border bg-muted/40 font-medium">
                    <td className="px-3 py-2 text-foreground">합계</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-foreground">{deptRows.total.monthN}건<span className="ml-1 text-[10px] text-muted-foreground">{fmt(deptRows.total.monthAmt)}</span></td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-foreground">{deptRows.total.yearN}건<span className="ml-1 text-[10px] text-muted-foreground">{fmt(deptRows.total.yearAmt)}</span></td>
                    <td className="px-3 py-2 text-right text-foreground">{deptRows.total.opportunity}건</td>
                    <td className="px-3 py-2 text-right text-foreground">{deptRows.total.selling}건</td>
                    <td className="px-3 py-2 text-right text-foreground">{deptRows.total.waiting}건</td>
                    <td className="px-3 py-2 text-right text-foreground">{deptRows.total.ongoing}건</td>
                    <td className="px-3 py-2 text-right text-foreground">{deptRows.total.completedYear}건</td>
                    <td className={`px-3 py-2 text-right ${deptRows.total.needsCheck > 0 ? 'text-red-600' : 'text-foreground'}`}>{deptRows.total.needsCheck}건</td>
                    <td className="px-3 py-2 text-right text-foreground">{deptRows.total.total}건</td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 4. 현재 영업 중인 건과 진행사항 */}
      <div className="glass-card rounded-xl p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-foreground">
            현재 영업 중인 건 <span className="ml-1 text-sm font-normal text-muted-foreground">{sellingList.length}건</span>
          </h2>
          <span className="text-xs text-muted-foreground">경과일은 기회식별일부터 지난 날수이며, 현재 단계에서 정체된 기간이 아닙니다</span>
        </div>
        {sellingList.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">영업 단계(기회 식별·영업 중)인 건이 없습니다.</p>
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted">
                  <th className="whitespace-nowrap px-3 py-2 text-left font-semibold text-foreground">사업부</th>
                  <th className="whitespace-nowrap px-3 py-2 text-left font-semibold text-foreground">고객사</th>
                  <th className="whitespace-nowrap px-3 py-2 text-left font-semibold text-foreground">프로젝트</th>
                  <th className="whitespace-nowrap px-3 py-2 text-left font-semibold text-foreground">상태</th>
                  <th className="px-3 py-2 text-left font-semibold text-foreground">영업 진행사항</th>
                  <th className="whitespace-nowrap px-3 py-2 text-left font-semibold text-foreground">기회식별일</th>
                  <th className="whitespace-nowrap px-3 py-2 text-right font-semibold text-foreground">경과일</th>
                </tr>
              </thead>
              <tbody>
                {sellingList.map(p => {
                  const elapsed = p.base_date ? -(daysUntil(p.base_date, today) ?? 0) : null;
                  const note = (p.sales_schedule_note || '').trim();
                  return (
                    <tr key={p.id} className="border-b border-border/50 align-top hover:bg-muted/30">
                      <td className="whitespace-nowrap px-3 py-2 text-foreground">{deptName(p.department_code)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-foreground">{p.client_name || '-'}</td>
                      <td className="min-w-[180px] px-3 py-2">
                        <p className="text-foreground">{p.project_name}</p>
                        {p.project_summary && <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">{p.project_summary}</p>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2"><span className={`rounded px-1.5 py-0.5 text-[11px] ${STATUS_STYLE[p.project_status]}`}>{p.project_status}</span></td>
                      <td className="min-w-[320px] max-w-[560px] whitespace-pre-wrap px-3 py-2 text-foreground">
                        {note || <span className="text-red-600">미입력</span>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-foreground">{p.base_date || '-'}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right text-foreground">{elapsed === null ? '-' : `${elapsed}일`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 5. 확인 필요 사항: 클릭하면 하단 목록이 해당 조건으로 필터됨 */}
      <div className="glass-card rounded-xl p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-foreground">확인 필요 사항</h2>
          <span className="text-xs text-muted-foreground">날짜·입력값 비교로 찾은 항목이며, 실제 지연이나 오류 여부는 담당 부서 확인이 필요합니다</span>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {kpi.checks.map(c => (
            <button key={c.key} type="button" onClick={() => applyQuick(c.key)}
              className={`rounded-lg border p-3 text-left transition-colors hover:bg-muted/40 ${quick === c.key ? 'border-primary bg-primary/5' : 'border-border'}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-foreground">{c.label}</span>
                <span className={`text-lg font-bold ${c.n > 0 && c.warn ? 'text-red-600' : 'text-foreground'}`}>{c.n}건</span>
              </div>
              <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{c.desc}</p>
            </button>
          ))}
        </div>
      </div>

      {/* 6. 전체 목록 (상태 요약 한 줄 + 상세 조회) */}
      <div className="glass-card rounded-xl p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-foreground">
            프로젝트 목록 <span className="ml-1 text-sm font-normal text-muted-foreground">{listed.length}건</span>
            {quick && <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-normal text-primary">{quickLabel[quick]}</span>}
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setQuick(''); }}
              className="rounded-lg border border-border bg-card px-2 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none">
              <option value="">상태 전체</option>
              {ORDERED_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="고객사·프로젝트·메모 검색"
                className="w-56 rounded-lg border border-border bg-card py-1.5 pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none" />
            </div>
            {(statusFilter || quick || search) && (
              <button onClick={clearFilters} className="flex items-center gap-1 rounded-lg border border-border px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground">
                <X className="h-3 w-3" /> 필터 해제
              </button>
            )}
          </div>
        </div>

        {/* 상태 요약 한 줄 (파이프라인) */}
        <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs">
          {kpi.pipeline.map((st, i) => (
            <Fragment key={st.status}>
              <button onClick={() => applyQuick('', st.status)}
                className={`flex items-center gap-1.5 rounded-md border px-2 py-1 transition-colors hover:bg-muted/40 ${statusFilter === st.status && !quick ? 'border-primary bg-primary/5' : 'border-border'}`}>
                <span className={`rounded px-1.5 py-0.5 text-[11px] ${STATUS_STYLE[st.status]}`}>{PIPELINE_LABEL[st.status]}</span>
                <span className="font-semibold text-foreground">{st.count}</span>
              </button>
              {i < kpi.pipeline.length - 1 && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
            </Fragment>
          ))}
        </div>

        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted">
                <th className="w-6 px-2 py-2"></th>
                {columns.map(col => (
                  <th key={col.key} className="whitespace-nowrap px-3 py-2 text-left font-semibold text-foreground">
                    <button onClick={() => handleSort(col.key)} className="flex items-center gap-1 hover:text-primary transition-colors">
                      {col.label} <SortIcon colKey={col.key} />
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {listed.length === 0 ? (
                <tr><td colSpan={columns.length + 1} className="py-8 text-center text-muted-foreground">조건에 맞는 프로젝트가 없습니다.</td></tr>
              ) : listed.map(p => {
                const remain = p.project_status === '프로젝트 중' ? daysUntil(p.end_date, today) : null;
                const overdue = remain !== null && remain < 0;
                const mismatch = isStatusDateMismatch(p);
                const open = expandedId === p.id;
                return (
                  <Fragment key={p.id}>
                    <tr onClick={() => setExpandedId(open ? null : p.id)}
                      className={`border-b border-border/50 cursor-pointer transition-colors hover:bg-muted/30 ${open ? 'bg-primary/5' : ''}`}>
                      <td className="px-2 py-2 text-muted-foreground">{open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-foreground">{deptName(p.department_code)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-foreground">{p.client_name || '-'}</td>
                      <td className="min-w-[200px] px-3 py-2 text-foreground">{p.project_name}</td>
                      <td className="whitespace-nowrap px-3 py-2"><span className={`rounded px-1.5 py-0.5 text-[11px] ${STATUS_STYLE[p.project_status] || 'bg-muted text-foreground'}`}>{p.project_status}</span></td>
                      <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{p.category || '-'}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-foreground">
                        {p.order_date || (isOrdered(p) && p.start_date ? <span className="text-muted-foreground" title="수주일 미입력, 시작일로 집계">({p.start_date})</span> : '-')}
                      </td>
                      <td className={`whitespace-nowrap px-3 py-2 ${mismatch ? 'font-medium text-red-600' : 'text-foreground'}`}>{p.start_date || '-'} ~ {p.end_date || '-'}</td>
                      <td className={`whitespace-nowrap px-3 py-2 text-right ${overdue ? 'font-medium text-red-600' : 'text-foreground'}`}>
                        {remain === null ? '-' : overdue ? `${Math.abs(remain)}일 경과 · 확인 필요` : `${remain}일`}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right text-foreground">{fmt(Number(p.sales_amount || 0))}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right text-foreground">{fmt(Number(p.purchase_amount || 0))}</td>
                      <td className="min-w-[260px] max-w-[460px] whitespace-pre-wrap px-3 py-2 text-muted-foreground">{p.sales_schedule_note || '-'}</td>
                    </tr>
                    {open && (
                      <tr className="border-b border-border/50 bg-muted/20">
                        <td></td>
                        <td colSpan={columns.length} className="px-3 py-3">
                          <div className="grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
                            <div><p className="text-muted-foreground">프로젝트 내용</p><p className="mt-0.5 whitespace-pre-wrap text-foreground">{p.project_summary || '-'}</p></div>
                            <div><p className="text-muted-foreground">수주 후 일정</p><p className="mt-0.5 whitespace-pre-wrap text-foreground">{p.secured_schedule_note || '-'}</p></div>
                            <div><p className="text-muted-foreground">라이선스 및 공수</p><p className="mt-0.5 whitespace-pre-wrap text-foreground">{p.effort || '-'}</p></div>
                            <div><p className="text-muted-foreground">비고</p><p className="mt-0.5 whitespace-pre-wrap text-foreground">{p.note || '-'}</p></div>
                            <div><p className="text-muted-foreground">기회식별일</p><p className="mt-0.5 text-foreground">{p.base_date || '-'}</p></div>
                            <div><p className="text-muted-foreground">순매출</p><p className="mt-0.5 text-foreground">{fmt(Number(p.sales_amount || 0) - Number(p.purchase_amount || 0))}</p></div>
                            <div><p className="text-muted-foreground">최종 수정</p><p className="mt-0.5 text-foreground">{p.updated_at?.slice(0, 10) || '-'}</p></div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
