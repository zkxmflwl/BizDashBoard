import { Fragment, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchBusinessProjects, BusinessProjectRow } from '@/services/businessProjectService';
import { useDepartments } from '@/hooks/useDepartments';
import { formatDashboardAmount } from '@/data/mockData';
import {
  Loader2, Briefcase, CheckCircle, Activity, Flag, Clock, AlertTriangle,
  ChevronDown, ChevronRight, ArrowUp, ArrowDown, ArrowUpDown, Search, X,
} from 'lucide-react';

/**
 * 영업 현황 (C레벨용 전사 조망)
 * - 접근: feature_access 'sales_overview' 보유자 또는 ADMIN (라우트에서 제어)
 * - 데이터: business_projects (is_active). 제한 부서 프로젝트는 RLS로 자동 제외됨
 * - 영업 단계(기회 식별·영업 중)에는 예상 매출이 입력되지 않으므로 건수 중심으로 표시
 */

const PIPELINE = ['기회 식별', '영업 중', '수주 완료', '프로젝트 중', '프로젝트 완료'] as const;
const CLOSED = ['영업 종결', '기타'];
const ORDERED_STATUSES = [...PIPELINE, ...CLOSED];
/** 수주 이후 단계: 매출 금액이 확정되어 합산 가능 */
const AMOUNT_STATUSES = new Set(['수주 완료', '프로젝트 중', '프로젝트 완료']);

const STATUS_STYLE: Record<string, string> = {
  '기회 식별': 'bg-slate-100 text-slate-700',
  '영업 중': 'bg-blue-100 text-blue-700',
  '수주 완료': 'bg-violet-100 text-violet-700',
  '프로젝트 중': 'bg-emerald-100 text-emerald-700',
  '프로젝트 완료': 'bg-gray-100 text-gray-600',
  '영업 종결': 'bg-red-100 text-red-600',
  '기타': 'bg-amber-100 text-amber-700',
};

type QuickFilter = '' | 'ending30' | 'overdue' | 'completedThisYear';
type SortDir = 'asc' | 'desc' | null;

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
const fmt = (n: number) => formatDashboardAmount(n);

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

  const today = todayKey();
  const thisYear = today.slice(0, 4);
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

  // 범위(부문·사업부) 필터: KPI·파이프라인·매트릭스의 기준
  const scoped = useMemo(() => {
    return allProjects.filter(p => {
      if (!p.is_active) return false;
      if (sectorDepts && !sectorDepts.has(p.department_code)) return false;
      if (selectedDept && p.department_code !== selectedDept) return false;
      return true;
    });
  }, [allProjects, sectorDepts, selectedDept]);

  const isOverdue = (p: BusinessProjectRow) => p.project_status === '프로젝트 중' && !!p.end_date && p.end_date < today;
  const isEnding30 = (p: BusinessProjectRow) => p.project_status === '프로젝트 중' && !!p.end_date && p.end_date >= today && p.end_date <= in30;
  const isCompletedThisYear = (p: BusinessProjectRow) => p.project_status === '프로젝트 완료' && !!p.end_date && p.end_date.startsWith(thisYear);

  // KPI
  const kpi = useMemo(() => {
    const by = (s: string) => scoped.filter(p => p.project_status === s);
    const sum = (list: BusinessProjectRow[]) => list.reduce((a, p) => a + Number(p.sales_amount || 0), 0);
    const ongoing = by('프로젝트 중');
    const completed = scoped.filter(isCompletedThisYear);
    return {
      opportunity: by('기회 식별').length,
      selling: by('영업 중').length,
      ordered: by('수주 완료').length,
      orderedAmount: sum(by('수주 완료')),
      ongoing: ongoing.length,
      ongoingAmount: sum(ongoing),
      completed: completed.length,
      completedAmount: sum(completed),
      ending30: scoped.filter(isEnding30).length,
      overdue: scoped.filter(isOverdue).length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoped, today]);

  // 파이프라인 (단계별 건수·금액)
  const pipeline = useMemo(() => PIPELINE.map(s => {
    const list = scoped.filter(p => p.project_status === s);
    return {
      status: s,
      count: list.length,
      amount: AMOUNT_STATUSES.has(s) ? list.reduce((a, p) => a + Number(p.sales_amount || 0), 0) : null,
    };
  }), [scoped]);

  // 사업부 × 상태 매트릭스
  const matrix = useMemo(() => {
    const rows = new Map<string, Record<string, { n: number; amt: number }>>();
    for (const p of scoped) {
      if (!rows.has(p.department_code)) {
        rows.set(p.department_code, Object.fromEntries(ORDERED_STATUSES.map(s => [s, { n: 0, amt: 0 }])));
      }
      const cell = rows.get(p.department_code)![p.project_status];
      if (cell) { cell.n += 1; cell.amt += Number(p.sales_amount || 0); }
    }
    return Array.from(rows.entries()).sort((a, b) => (deptOrder.get(a[0]) ?? 999) - (deptOrder.get(b[0]) ?? 999));
  }, [scoped, deptOrder]);

  // 목록 (상태·빠른 필터·검색 적용)
  const listed = useMemo(() => {
    let list = scoped.filter(p => {
      if (statusFilter && p.project_status !== statusFilter) return false;
      if (quick === 'overdue' && !isOverdue(p)) return false;
      if (quick === 'ending30' && !isEnding30(p)) return false;
      if (quick === 'completedThisYear' && !isCompletedThisYear(p)) return false;
      if (search) {
        const s = search.toLowerCase();
        const hay = [p.client_name, p.project_name, p.project_summary, p.category, p.sales_schedule_note, p.note].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
    const statusRank = (s: string) => { const i = (ORDERED_STATUSES as readonly string[]).indexOf(s); return i < 0 ? 99 : i; };
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

  const applyQuick = (q: QuickFilter, status = '') => {
    setQuick(prev => (prev === q && statusFilter === status ? '' : q));
    setStatusFilter(prev => (quick === q && prev === status ? '' : status));
  };
  const clearFilters = () => { setStatusFilter(''); setQuick(''); setSearch(''); };

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

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">영업 현황</h1>
          <p className="mt-1 text-sm text-muted-foreground">전사 프로젝트 파이프라인과 진행 상태 (기준일 {today})</p>
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

      {/* KPI 카드: 클릭하면 아래 목록이 해당 조건으로 필터됨 */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <KpiCard title="영업 중" value={`${kpi.selling}건`} sub={kpi.opportunity > 0 ? `기회 식별 ${kpi.opportunity}건` : undefined}
          icon={<Briefcase className="h-4 w-4" />} active={statusFilter === '영업 중' && !quick} onClick={() => applyQuick('', '영업 중')} />
        <KpiCard title="수주 완료 (착수 대기)" value={`${kpi.ordered}건`} sub={fmt(kpi.orderedAmount)}
          icon={<CheckCircle className="h-4 w-4" />} active={statusFilter === '수주 완료' && !quick} onClick={() => applyQuick('', '수주 완료')} />
        <KpiCard title="프로젝트 진행 중" value={`${kpi.ongoing}건`} sub={fmt(kpi.ongoingAmount)}
          icon={<Activity className="h-4 w-4" />} active={statusFilter === '프로젝트 중' && !quick} onClick={() => applyQuick('', '프로젝트 중')} />
        <KpiCard title={`${thisYear}년 완료`} value={`${kpi.completed}건`} sub={fmt(kpi.completedAmount)}
          icon={<Flag className="h-4 w-4" />} active={quick === 'completedThisYear'} onClick={() => applyQuick('completedThisYear')} />
        <KpiCard title="30일 내 종료 예정" value={`${kpi.ending30}건`}
          icon={<Clock className="h-4 w-4" />} active={quick === 'ending30'} onClick={() => applyQuick('ending30')} />
        <KpiCard title="종료일 경과 (상태 미갱신)" value={`${kpi.overdue}건`} tone={kpi.overdue > 0 ? 'text-red-600' : ''}
          icon={<AlertTriangle className="h-4 w-4" />} active={quick === 'overdue'} onClick={() => applyQuick('overdue')} />
      </div>

      {/* 파이프라인 */}
      <div className="glass-card rounded-xl p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground">파이프라인</h2>
          <span className="text-xs text-muted-foreground">영업 단계는 예상 금액 미입력으로 건수만 표시 (단위: 원)</span>
        </div>
        <div className="flex flex-wrap items-stretch gap-2">
          {pipeline.map((st, i) => (
            <div key={st.status} className="flex items-center gap-2">
              <button onClick={() => applyQuick('', st.status)}
                className={`min-w-[150px] rounded-lg border px-4 py-3 text-left transition-colors hover:bg-muted/40 ${statusFilter === st.status && !quick ? 'border-primary bg-primary/5' : 'border-border'}`}>
                <div className="flex items-center gap-2">
                  <span className={`rounded px-1.5 py-0.5 text-[11px] ${STATUS_STYLE[st.status]}`}>{st.status}</span>
                </div>
                <p className="mt-1.5 text-lg font-bold text-foreground">{st.count}건</p>
                <p className="text-xs text-muted-foreground">{st.amount === null ? '금액 미집계' : fmt(st.amount)}</p>
              </button>
              {i < pipeline.length - 1 && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
            </div>
          ))}
        </div>
      </div>

      {/* 사업부 × 상태 매트릭스 */}
      <div className="glass-card rounded-xl p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground">사업부별 현황</h2>
          <span className="text-xs text-muted-foreground">건수 / 수주 이후 단계는 매출 합계</span>
        </div>
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted">
                <th className="px-3 py-2 text-left font-semibold text-foreground">사업부</th>
                {ORDERED_STATUSES.map(s => <th key={s} className="whitespace-nowrap px-3 py-2 text-right font-semibold text-foreground">{s}</th>)}
                <th className="px-3 py-2 text-right font-semibold text-foreground">합계</th>
              </tr>
            </thead>
            <tbody>
              {matrix.length === 0 ? (
                <tr><td colSpan={ORDERED_STATUSES.length + 2} className="py-6 text-center text-muted-foreground">데이터 없음</td></tr>
              ) : matrix.map(([code, cells]) => {
                const total = Object.values(cells).reduce((a, c) => a + c.n, 0);
                return (
                  <tr key={code} className="border-b border-border/50 hover:bg-muted/30 cursor-pointer" onClick={() => setSelectedDept(prev => prev === code ? '' : code)}>
                    <td className="whitespace-nowrap px-3 py-2 font-medium text-foreground">{deptName(code)}</td>
                    {ORDERED_STATUSES.map(s => {
                      const c = cells[s];
                      return (
                        <td key={s} className="whitespace-nowrap px-3 py-2 text-right text-foreground">
                          {c.n === 0 ? <span className="text-muted-foreground/50">-</span> : (
                            <>
                              {c.n}건
                              {AMOUNT_STATUSES.has(s) && c.amt > 0 && <span className="ml-1 text-[10px] text-muted-foreground">{fmt(c.amt)}</span>}
                            </>
                          )}
                        </td>
                      );
                    })}
                    <td className="px-3 py-2 text-right font-medium text-foreground">{total}건</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 프로젝트 목록 */}
      <div className="glass-card rounded-xl p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-foreground">
            프로젝트 목록 <span className="ml-1 text-sm font-normal text-muted-foreground">{listed.length}건</span>
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
                      <td className="whitespace-nowrap px-3 py-2 text-foreground">{p.order_date || '-'}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-foreground">{p.start_date || '-'} ~ {p.end_date || '-'}</td>
                      <td className={`whitespace-nowrap px-3 py-2 text-right ${overdue ? 'font-medium text-red-600' : 'text-foreground'}`}>
                        {remain === null ? '-' : overdue ? `${Math.abs(remain)}일 경과` : `${remain}일`}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right text-foreground">{fmt(Number(p.sales_amount || 0))}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right text-foreground">{fmt(Number(p.purchase_amount || 0))}</td>
                      <td className="max-w-[260px] truncate px-3 py-2 text-muted-foreground" title={p.sales_schedule_note || ''}>{p.sales_schedule_note || '-'}</td>
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
