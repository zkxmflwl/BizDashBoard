import { useState, useMemo } from 'react';
import { useDashboardStats, useDeptSummary } from '@/hooks/useDashboardStats';
import { isNewDepartment } from '@/services/dashboardService';
import { useAvailableMonths } from '@/hooks/useSalesData';
import { useTangibleAssets } from '@/hooks/useTangibleAssets';
import { useIntangibleAssets } from '@/hooks/useIntangibleAssets';
import { useDepartments } from '@/hooks/useDepartments';
import { formatKRW, formatKRWShort, format10MAmount, format1MAmount, formatDashboardAmount } from '@/data/mockData';
import StatCard from '@/components/StatCard';
import MonthlyBarChart from '@/components/MonthlyBarChart';
import { TrendingUp, TrendingDown, DollarSign, Briefcase, CheckCircle, AlertTriangle, Clock, Loader2, ArrowUp, ArrowDown, ArrowUpDown, CircleDollarSign, Receipt, HandCoins, Banknote, BanknoteArrowDown, BanknoteArrowUp } from 'lucide-react';

type SortDir = 'asc' | 'desc' | null;

import { useRef, useEffect, useCallback } from 'react';

export default function Dashboard() {
  const { data: months = [] } = useAvailableMonths();
  const [selectedMonth, setSelectedMonth] = useState('');
  const activeMonth = selectedMonth || months[0] || '';

  const { data: stats, isLoading: statsLoading } = useDashboardStats(activeMonth);
  const { data: deptRows = [], isLoading: deptLoading } = useDeptSummary(activeMonth);
  const { data: tangibleAssets, isLoading: tangibleLoading } = useTangibleAssets();
  const { data: intangibleAssets, isLoading: intangibleLoading } = useIntangibleAssets();
  const { data: departments = [] } = useDepartments();

  const [selectedDeptCode, setSelectedDeptCode] = useState<string | null>(null);
  const [selectedSector, setSelectedSector] = useState<string | null>(null); // null = 전체
  const gridRef = useRef<HTMLDivElement>(null);
  const [chartMode, setChartMode] = useState<'cumulative' | 'monthly'>('cumulative');
  // 제한 부서(자회사) 포함 여부: 열람 권한자에게만 토글이 보이며 기본은 제외
  const [includeSubsidiary, setIncludeSubsidiary] = useState(false);
  const activeYear = Number(activeMonth.split('-')[0]) || new Date().getFullYear();

  // 부문 목록 (sort_order 우선)
  const sectors = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of departments) {
      if (d.sector_code && d.sector_name && !map.has(d.sector_code)) {
        map.set(d.sector_code, d.sector_name);
      }
    }
    return Array.from(map.entries()).map(([code, name]) => ({ code, name }));
  }, [departments]);

  // 선택된 부문에 속하는 부서 코드 집합
  const sectorDeptCodes = useMemo(() => {
    if (!selectedSector) return null;
    return new Set(
      departments.filter(d => d.sector_code === selectedSector).map(d => d.department_code)
    );
  }, [departments, selectedSector]);

  // Click outside grid to deselect
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (gridRef.current && !gridRef.current.contains(e.target as Node)) {
        setSelectedDeptCode(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);

  const handleSort = (key: string) => {
    if (sortKey !== key) { setSortKey(key); setSortDir('asc'); }
    else if (sortDir === 'asc') setSortDir('desc');
    else { setSortKey(null); setSortDir(null); }
  };

  const sortedDeptRows = useMemo(() => {
    if (!sortKey || !sortDir) return deptRows;
    return [...deptRows].sort((a, b) => {
      const aVal = (a as any)[sortKey];
      const bVal = (b as any)[sortKey];
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
      }
      const cmp = String(aVal ?? '').localeCompare(String(bVal ?? ''), 'ko', { numeric: true });
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [deptRows, sortKey, sortDir]);

  // 제한 부서(자회사) 행이 보이는지 (열람 권한이 있을 때만 데이터가 내려옴)
  const hasRestrictedRows = useMemo(() => deptRows.some(r => r.isRestricted), [deptRows]);

  // 실제 적용할 부서 집합: 부문 선택 > 자회사 제외(기본) > 전체
  const effectiveDeptCodes = useMemo(() => {
    if (sectorDeptCodes) return sectorDeptCodes;
    if (hasRestrictedRows && !includeSubsidiary) {
      return new Set(deptRows.filter(r => !r.isRestricted).map(r => r.departmentCode));
    }
    return null;
  }, [sectorDeptCodes, hasRestrictedRows, includeSubsidiary, deptRows]);

  // 필터링 적용된 행
  const filteredDeptRows = useMemo(() => {
    if (!effectiveDeptCodes) return sortedDeptRows;
    return sortedDeptRows.filter(r => effectiveDeptCodes.has(r.departmentCode));
  }, [sortedDeptRows, effectiveDeptCodes]);

  // 카드용 stats: 부문 선택·자회사 제외 시 행 단위로 재계산 (전년 누적도 행에 포함되어 있음)
  const displayStats = useMemo(() => {
    if (!effectiveDeptCodes) return stats;
    let ytdSales = 0, ytdPurchase = 0, prevYtdSales = 0, prevYtdPurchase = 0;
    let activeProjects = 0, monthlyOrders = 0;
    for (const r of filteredDeptRows) {
      ytdSales += r.ytdSales;
      ytdPurchase += r.ytdPurchase;
      prevYtdSales += r.prevYtdSales ?? 0;
      prevYtdPurchase += r.prevYtdPurchase ?? 0;
      activeProjects += r.activeProjects;
      monthlyOrders += r.monthlyOrders;
    }
    return {
      ytdSales,
      ytdPurchase,
      ytdNetSales: ytdSales - ytdPurchase,
      prevYtdSales,
      prevYtdPurchase,
      prevYtdNetSales: prevYtdSales - prevYtdPurchase,
      activeProjectCount: activeProjects,
      monthlyOrderCount: monthlyOrders,
    };
  }, [stats, filteredDeptRows, effectiveDeptCodes]);

  // 차트용: 단일 행 선택 > 부문/자회사 제외 > 전체
  const chartDeptCodes = useMemo(() => {
    if (selectedDeptCode) return [selectedDeptCode];
    if (effectiveDeptCodes) return Array.from(effectiveDeptCodes);
    return undefined;
  }, [selectedDeptCode, effectiveDeptCodes]);

  const isLoading = statsLoading || tangibleLoading || intangibleLoading;

  const oldestTangible = [...(tangibleAssets || [])]
    .filter((a) => a.purchase_date)
    .sort((a, b) => new Date(a.purchase_date!).getTime() - new Date(b.purchase_date!).getTime())
    .slice(0, 10);

  const oldestIntangible = [...(intangibleAssets || [])]
    .filter((a) => a.expiry_date)
    .sort((a, b) => new Date(a.expiry_date!).getTime() - new Date(b.expiry_date!).getTime())
    .slice(0, 10);

  if (isLoading && !months.length) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  const SortIcon = ({ colKey }: { colKey: string }) => {
    if (sortKey === colKey) {
      return sortDir === 'asc' ? <ArrowUp className="h-3 w-3 text-primary" /> : <ArrowDown className="h-3 w-3 text-primary" />;
    }
    return <ArrowUpDown className="h-3 w-3 opacity-30" />;
  };

  const summaryColumns = [
    { key: 'departmentName', label: '사업부명' },
    { key: 'ytdSales', label: '누적매출' },
    { key: 'ytdPurchase', label: '누적매입' },
    { key: 'ytdNetSales', label: '누적순매출' },
    { key: 'yoyChange', label: '전년동기대비매출' },
    { key: 'monthlySales', label: '당월 매출' },
    { key: 'monthlyPurchase', label: '당월 매입' },
    { key: 'monthlyNetSales', label: '당월 순매출' },
    { key: 'activeProjects', label: '영업 중인 건' },
    { key: 'monthlyOrders', label: '당월 수주 건' },
  ];

  return (
    <div className="space-y-8">
      {/* 헤더 영역: justify-between을 제거하고 gap을 추가하여 왼쪽으로 정렬 */}
      <div className="flex flex-col sm:flex-row sm:items-end gap-4 sm:gap-10">
        <div>
          <h1 className="text-2xl font-bold text-foreground">대시보드</h1>
          <p className="mt-1 text-sm text-muted-foreground">CSPI 사업부 현황 요약</p>
        </div>

        {months.length > 0 && (
          <div className="flex items-center gap-3 pb-0.5">
            <span className="text-sm font-medium text-muted-foreground whitespace-nowrap">기준 년월</span>
            <select 
              value={activeMonth} 
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none transition-colors cursor-pointer hover:border-muted-foreground/50"
            >
              {months.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        )}
      </div>

      {/* 부문 탭 */}
      {sectors.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 rounded-lg border border-border bg-card p-1">
          <button
            onClick={() => { setSelectedSector(null); setSelectedDeptCode(null); }}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
              selectedSector === null
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
          >
            전체
          </button>
          {sectors.map(s => (
            <button
              key={s.code}
              onClick={() => { setSelectedSector(s.code); setSelectedDeptCode(null); }}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                selectedSector === s.code
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
            >
              {s.name}
            </button>
          ))}
          {hasRestrictedRows && selectedSector === null && (
            <label className="ml-auto flex cursor-pointer items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={includeSubsidiary}
                onChange={(e) => setIncludeSubsidiary(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-border accent-primary"
              />
              자회사 포함
            </label>
          )}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <StatCard
          title="누적 매출"
          value={formatDashboardAmount(displayStats?.ytdSales ?? 0)}
          icon={<BanknoteArrowDown className="h-5 w-5" />}
          change={displayStats && displayStats.prevYtdSales ? displayStats.ytdSales - displayStats.prevYtdSales : undefined}
          changeLabel="YoY"
        />

        <StatCard
          title="누적 매입"
          value={formatDashboardAmount(displayStats?.ytdPurchase ?? 0)}
          icon={<BanknoteArrowUp className="h-5 w-5" />}
          change={displayStats && displayStats.prevYtdPurchase ? displayStats.ytdPurchase - displayStats.prevYtdPurchase : undefined}
          changeLabel="YoY"
        />

        <StatCard
          title="누적 순매출"
          value={formatDashboardAmount(displayStats?.ytdNetSales ?? 0)}
          icon={<HandCoins className="h-5 w-5" />}
          change={displayStats && displayStats.prevYtdNetSales ? displayStats.ytdNetSales - displayStats.prevYtdNetSales : undefined}
          changeLabel="YoY"
        />
        <StatCard title="영업 중인 건" value={`${displayStats?.activeProjectCount ?? 0}건`} icon={<Briefcase className="h-5 w-5" />} />
        <StatCard title="당월 수주 건" value={`${displayStats?.monthlyOrderCount ?? 0}건`} icon={<CheckCircle className="h-5 w-5" />} />
      </div>

      {/* 사업부 별 실적 요약 */}
      <div ref={gridRef} className="glass-card rounded-xl p-6 animate-fade-in">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-foreground">
            사업부 별 실적 요약
            {selectedDeptCode && <span className="ml-2 text-sm font-normal text-primary">(그래프 필터 적용 중 — 행 외부 클릭 시 해제)</span>}
          </h2>
          <span className="text-xs text-muted-foreground">(단위: 원)</span>
        </div>
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted">
                {summaryColumns.map(col => (
                  <th key={col.key} className="whitespace-nowrap border-r border-border/50 last:border-r-0 px-3 py-2.5 text-left font-semibold text-foreground">
                    <button onClick={() => handleSort(col.key)} className="flex items-center gap-1 hover:text-primary transition-colors">
                      {col.label} <SortIcon colKey={col.key} />
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {deptLoading ? (
                <tr><td colSpan={summaryColumns.length} className="py-8 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto text-primary" /></td></tr>
              ) : filteredDeptRows.length === 0 ? (
                <tr><td colSpan={summaryColumns.length} className="py-8 text-center text-muted-foreground">데이터 없음</td></tr>
              ) : filteredDeptRows.map((row) => (
                <tr
                  key={row.departmentCode}
                  onClick={() => setSelectedDeptCode(prev => prev === row.departmentCode ? null : row.departmentCode)}
                  className={`border-b border-border/50 cursor-pointer transition-colors ${selectedDeptCode === row.departmentCode ? 'bg-primary/10 hover:bg-primary/15' : 'hover:bg-muted/30'}`}
                >
                  <td className="border-r border-border/50 px-3 py-2 text-foreground font-medium whitespace-nowrap">
                    {row.departmentName}
                    {isNewDepartment(row.establishedMonth, activeYear) && (
                      <span className="ml-1.5 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-normal text-emerald-700" title="전년 동기 데이터가 없는 신설·분리 부서">
                        신설 {row.establishedMonth}
                      </span>
                    )}
                    {row.isRestricted && (
                      <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-normal text-amber-700">자회사</span>
                    )}
                  </td>
                  <td className="border-r border-border/50 px-3 py-2 text-right text-foreground">{formatDashboardAmount(row.ytdSales)}</td>
                  <td className="border-r border-border/50 px-3 py-2 text-right text-foreground">{formatDashboardAmount(row.ytdPurchase)}</td>
                  <td className="border-r border-border/50 px-3 py-2 text-right text-foreground">{formatDashboardAmount(row.ytdNetSales)}</td>
                  <td className="border-r border-border/50 px-3 py-2 text-right">
                    {row.yoyChange === null ? (
                      <span className="text-muted-foreground" title="전년 동기 데이터 없음 (신설·분리 부서)">-</span>
                    ) : (
                      <span className="whitespace-nowrap">
                        <span className={row.yoyChange > 0 ? 'text-red-500' : row.yoyChange < 0 ? 'text-blue-500' : 'text-foreground'}>
                          {row.yoyChange > 0 ? '+' : ''}{formatDashboardAmount(row.yoyChange)}
                        </span>
                        {row.yoyIncludes.length > 0 && (
                          <span className="ml-1 text-[10px] text-muted-foreground" title="분리 전 범위와 비교하기 위해 승계 부서의 당해 누적을 합산한 값">
                            ({row.yoyIncludes.join(', ')} 포함)
                          </span>
                        )}
                      </span>
                    )}
                  </td>
                  <td className="border-r border-border/50 px-3 py-2 text-right text-foreground">{formatDashboardAmount(row.monthlySales)}</td>
                  <td className="border-r border-border/50 px-3 py-2 text-right text-foreground">{formatDashboardAmount(row.monthlyPurchase)}</td>
                  <td className="border-r border-border/50 px-3 py-2 text-right text-foreground">{formatDashboardAmount(row.monthlyNetSales)}</td>
                  <td className="border-r border-border/50 px-3 py-2 text-center text-foreground">{row.activeProjects}건</td>
                  <td className="px-3 py-2 text-center text-foreground">{row.monthlyOrders}건</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 월별 매출/매입/순매출 막대 그래프 */}
      <div className="glass-card rounded-xl p-6 animate-fade-in">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <h2 className="text-lg font-semibold text-foreground">
            {activeMonth.split('-')[0]}년 월별 매출·매입·순매출
            {selectedDeptCode && filteredDeptRows.find(r => r.departmentCode === selectedDeptCode) && (
              <span className="ml-2 text-sm text-primary">
                — {filteredDeptRows.find(r => r.departmentCode === selectedDeptCode)?.departmentName}
              </span>
            )}
          </h2>
          {/* 탭 */}
          <div className="flex rounded-lg border border-border overflow-hidden text-xs">
            <button
              onClick={() => setChartMode('cumulative')}
              className={`px-3 py-1.5 transition-colors ${
                chartMode === 'cumulative'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-card text-muted-foreground hover:text-foreground'
              }`}
            >
              누적
            </button>
            <button
              onClick={() => setChartMode('monthly')}
              className={`px-3 py-1.5 border-l border-border transition-colors ${
                chartMode === 'monthly'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-card text-muted-foreground hover:text-foreground'
              }`}
            >
              월별
            </button>
          </div>
        </div>
        <MonthlyBarChart
          year={activeMonth.split('-')[0]}
          departmentCodes={chartDeptCodes}
          mode={chartMode}
          activeMonth={activeMonth}
        />
      </div>


      {/*
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="glass-card rounded-xl p-6 animate-fade-in">
          <div className="mb-4 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-warning" />
            <h2 className="text-lg font-semibold text-foreground">교체 우선순위 (유형자산)</h2>
          </div>
          <p className="mb-4 text-xs text-muted-foreground">구매일 기준 가장 오래된 자산 Top 10</p>
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="pb-3 pr-4">종류</th>
                  <th className="pb-3 pr-4">모델</th>
                  <th className="pb-3 pr-4">소속</th>
                  <th className="pb-3">구매일</th>
                </tr>
              </thead>
              <tbody>
                {oldestTangible.length === 0 ? (
                  <tr><td colSpan={4} className="py-8 text-center text-muted-foreground">데이터 없음</td></tr>
                ) : oldestTangible.map((asset) => (
                  <tr key={asset.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                    <td className="py-2.5 pr-4 text-foreground">{asset.asset_types?.sub_category || '-'}</td>
                    <td className="py-2.5 pr-4 text-foreground">{asset.model_name || '-'}</td>
                    <td className="py-2.5 pr-4 text-muted-foreground">{asset.departments?.department_name || '-'}</td>
                    <td className="py-2.5 text-warning font-medium">{asset.purchase_date || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="glass-card rounded-xl p-6 animate-fade-in">
          <div className="mb-4 flex items-center gap-2">
            <Clock className="h-4 w-4 text-info" />
            <h2 className="text-lg font-semibold text-foreground">만료 임박 (무형자산)</h2>
          </div>
          <p className="mb-4 text-xs text-muted-foreground">만료일 기준 가장 빠른 자산 Top 10</p>
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="pb-3 pr-4">이름</th>
                  <th className="pb-3 pr-4">공급사</th>
                  <th className="pb-3 pr-4">부서</th>
                  <th className="pb-3">만료일</th>
                </tr>
              </thead>
              <tbody>
                {oldestIntangible.length === 0 ? (
                  <tr><td colSpan={4} className="py-8 text-center text-muted-foreground">데이터 없음</td></tr>
                ) : oldestIntangible.map((asset) => (
                  <tr key={asset.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                    <td className="py-2.5 pr-4 text-foreground">{asset.license_name}</td>
                    <td className="py-2.5 pr-4 text-muted-foreground">{asset.vendor_name || '-'}</td>
                    <td className="py-2.5 pr-4 text-muted-foreground">{asset.departments?.department_name || '-'}</td>
                    <td className="py-2.5 text-info font-medium">{asset.expiry_date || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
        */}
    </div>
  );
}
