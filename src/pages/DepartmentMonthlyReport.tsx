import { useState, useMemo, useEffect  } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useDepartments } from '@/hooks/useDepartments';
import { useAvailableDeptMonths } from '@/hooks/useSalesData';
import { fetchSalesSummary, SalesSummaryRow } from '@/services/salesService';
import { fetchProjectsByDeptAndStatus, fetchOngoingProjectsByDept, fetchProjectsOrdered } from '@/services/businessProjectService';
import { formatKRW, formatMonthlyAmount } from '@/data/mockData';
import { Loader2 } from 'lucide-react';

// Gantt bar colors by category
const CATEGORY_COLORS = [
  'bg-blue-400', 'bg-emerald-400', 'bg-amber-400', 'bg-rose-400',
  'bg-purple-400', 'bg-cyan-400', 'bg-orange-400', 'bg-pink-400',
];

// 전월대비
function getPrevMonthKey(monthKey: string): string {
  if (!monthKey) return '';
  const [y, m] = monthKey.split('-').map(Number);
  if (m === 1) return `${y - 1}-12`;
  return `${y}-${String(m - 1).padStart(2, '0')}`;
}

// 당월 매출·매입·순매출의 전년 동월 대비(YoY)는 계약 시점에 따라 월별 편차가 커 의미가 없어 표시하지 않는다.
// 전년 비교는 대시보드의 누적 기준을 사용한다.

export default function DepartmentMonthlyReport() {
  const { data: departments = [] } = useDepartments();
  const [selectedDept, setSelectedDept] = useState('__none__');
  const [selectedMonth, setSelectedMonth] = useState('');

  const activeDept = selectedDept === '__none__' ? '' : selectedDept || departments[0]?.department_code || '';

  const { data: months = [] } = useAvailableDeptMonths(activeDept);

  // 사업부가 바뀌면 월 선택 초기화 → 새 목록의 첫 번째(최신)로 자동 설정
  useEffect(() => {
    setSelectedMonth('');
  }, [activeDept]);

  const activeMonth = selectedMonth || months[0] || '';
  const prevMonth = getPrevMonthKey(activeMonth);
  const activeYear = activeMonth ? Number(activeMonth.split('-')[0]) : new Date().getFullYear();

  const deptName = departments.find(d => d.department_code === activeDept)?.department_name || activeDept;

  // Current month sales data for this department
  const { data: currentMonthData = [] } = useQuery({
    queryKey: ['dept-sales', activeDept, activeMonth],
    queryFn: () => fetchSalesSummary(activeMonth),
    enabled: !!activeDept && !!activeMonth,
  });

  const { data: prevMonthData = [] } = useQuery({
    queryKey: ['dept-sales', activeDept, prevMonth],
    queryFn: () => fetchSalesSummary(prevMonth),
    enabled: !!prevMonth,
  });

  const deptCurrent = currentMonthData.find(r => r.department_code === activeDept);
  const deptMonthPrev = prevMonthData.find(r => r.department_code === activeDept);

  const curSales = Number(deptCurrent?.sales_amount || 0);
  const curPurchase = Number(deptCurrent?.purchase_amount || 0);
  const curNetSales = curSales - curPurchase;

  // Ongoing projects (프로젝트 중)
  const { data: ongoingProjects = [] } = useQuery({
    queryKey: ['ongoing-projects', activeDept, activeYear],
    queryFn: () => fetchOngoingProjectsByDept(activeDept, activeYear),
    enabled: !!activeDept,
  });

  // 수주 완료
  const { data: completedOrders = [] } = useQuery({
    queryKey: ['completed-orders', activeDept],
    queryFn: () => fetchProjectsOrdered(activeDept),
    enabled: !!activeDept,
  });

  // 영업 중
  const { data: salesProjects = [] } = useQuery({
    queryKey: ['sales-projects', activeDept],
    queryFn: () => fetchProjectsByDeptAndStatus(activeDept, '영업 중'),
    enabled: !!activeDept,
  });

  // Filter completed orders: order_date <= selected month end
  const filteredOrders = useMemo(() => {
    if (!activeMonth) return completedOrders;
    return completedOrders.filter(p => {
      if (!p.order_date) return false;
      return p.order_date.startsWith(activeMonth); // 선택한 월과 동일한 것만
    });
  }, [completedOrders, activeMonth]);

  // Filter sales projects relevant to selected year/month
  const filteredSalesProjects = useMemo(() => {
    return salesProjects.filter(p => {
      const base = p.base_date;
      if (!base) return true;
      const activeYear = Number(activeMonth.split('-')[0]);
      const baseYear = Number(base.split('-')[0]);
      // 선택 연도 및 전년도 모두 포함
      return baseYear >= activeYear - 1;
    });
  }, [salesProjects, activeMonth]);

  // Gantt: Build category color map
  const categoryColorMap = useMemo(() => {
    const categories = [...new Set(ongoingProjects.map(p => p.category || '기타'))].sort();
    const map: Record<string, string> = {};
    categories.forEach((cat, i) => { map[cat] = CATEGORY_COLORS[i % CATEGORY_COLORS.length]; });
    return map;
  }, [ongoingProjects]);

  // 18-month Gantt: prev July to current December
  const ganttMonths = useMemo(() => {
    const months: { year: number; month: number; label: string }[] = [];
    for (let m = 7; m <= 12; m++) {
      months.push({ year: activeYear - 1, month: m, label: `${String(activeYear - 1).slice(2)}.${m}월` });
    }
    for (let m = 1; m <= 12; m++) {
      months.push({ year: activeYear, month: m, label: `${m}월` });
    }
    return months;
  }, [activeYear]);

  const monthLabels = ganttMonths.map(g => g.label);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">사업부 월간 보고</h1>
        <p className="mt-1 text-sm text-muted-foreground">부서별 월간 실적 및 프로젝트 현황</p>
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">사업부</span>
          <select value={selectedDept} onChange={(e) => setSelectedDept(e.target.value)}
            className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none">
            <option value="__none__">선택</option>
            {departments.map((d) => <option key={d.department_code} value={d.department_code}>{d.department_name}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">년월</span>
          <select value={activeMonth} onChange={(e) => setSelectedMonth(e.target.value)}
            className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none">
            {months.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">총원</p>
          <p className="mt-1 text-lg font-bold text-foreground">{deptCurrent?.total_headcount ?? 0}명</p>
          {deptMonthPrev != null && (() => {
            const diff = (deptCurrent?.total_headcount ?? 0) - (deptMonthPrev?.total_headcount ?? 0);
            if (diff === 0) return <p className="mt-1 text-xs text-muted-foreground">-</p>;
            return <span className={`text-xs ${diff > 0 ? 'text-red-500' : 'text-blue-500'}`}>{diff > 0 ? '+' : ''}MoM {diff}명</span>;
          })()}
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">당월 매출</p>
          <p className="mt-1 text-lg font-bold text-foreground">{formatMonthlyAmount(curSales)}원</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">당월 매입</p>
          <p className="mt-1 text-lg font-bold text-foreground">{formatMonthlyAmount(curPurchase)}원</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">당월 순매출</p>
          <p className="mt-1 text-lg font-bold text-foreground">{formatMonthlyAmount(curNetSales)}원</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">부서 현황</p>
          <p className="mt-1 text-sm text-foreground whitespace-pre-wrap">{deptCurrent?.note || '-'}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">인원 비고</p>
          <p className="mt-1 text-sm text-foreground whitespace-pre-wrap">{deptCurrent?.headcount_note || '-'}</p>
        </div>
      </div>

      {/* Section 1: 프로젝트 현황 - Gantt */}
      <div className="glass-card rounded-xl p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">프로젝트 현황</h2>
        {ongoingProjects.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">진행 중인 프로젝트가 없습니다.</p>
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-2 py-2 min-w-[100px] text-foreground">고객사명</th>
                  <th className="text-left px-2 py-2 min-w-[150px] text-foreground">프로젝트 명</th>
                  {monthLabels.map((m, i) => (
                    <th key={i} className="text-center px-0.5 py-2 min-w-[32px] text-muted-foreground text-[10px]">{m}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...ongoingProjects].map((proj) => {
                  const startDate = proj.start_date ? new Date(proj.start_date) : null;
                  const endDate = proj.end_date ? new Date(proj.end_date) : null;
                  const cat = proj.category || '기타';
                  const barColor = categoryColorMap[cat] || 'bg-blue-400';

                  return (
                    <tr key={proj.id} className="border-b border-border/50">
                      <td className="px-2 py-2 text-foreground">{proj.client_name || '-'}</td>
                      <td className="px-2 py-2 text-foreground">{proj.project_name}</td>
                      {ganttMonths.map((gm, idx) => {
                        const cellStart = new Date(gm.year, gm.month - 1, 1);
                        const cellEnd = new Date(gm.year, gm.month, 0);

                        let active = false;
                        if (startDate && startDate <= cellEnd) {
                          if (!endDate || endDate >= cellStart) {
                            active = true;
                          }
                        }

                        return (
                          <td key={idx} className="px-0.5 py-2">
                            {active ? (
                              <div className={`h-4 rounded ${barColor} opacity-80`} title={`${proj.project_name} (${cat})`} />
                            ) : null}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {/* Legend */}
            <div className="flex flex-wrap gap-3 mt-3 pt-2 border-t border-border/50">
              {Object.entries(categoryColorMap).map(([cat, color]) => (
                <div key={cat} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <div className={`h-3 w-6 rounded ${color} opacity-80`} />
                  <span>{cat}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Section 2: 수주 현황 */}
      <div className="glass-card rounded-xl p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">수주 현황</h2>
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted">
                <th className="text-left px-3 py-2.5 font-semibold text-foreground border-r border-border/50">고객사명</th>
                <th className="text-left px-3 py-2.5 font-semibold text-foreground border-r border-border/50">프로젝트 명</th>
                <th className="text-left px-3 py-2.5 font-semibold text-foreground border-r border-border/50">프로젝트 내용</th>
                <th className="text-left px-3 py-2.5 font-semibold text-foreground border-r border-border/50">매출</th>
                <th className="text-left px-3 py-2.5 font-semibold text-foreground">비고</th>
              </tr>
            </thead>
            <tbody>
              {filteredOrders.length === 0 ? (
                <tr><td colSpan={5} className="py-8 text-center text-muted-foreground">데이터 없음</td></tr>
              ) : filteredOrders.map((p) => (
                <tr key={p.id} className="border-b border-border/50 hover:bg-muted/30">
                  <td className="px-3 py-2 text-foreground border-r border-border/50">{p.client_name || '-'}</td>
                  <td className="px-3 py-2 text-foreground border-r border-border/50">{p.project_name}</td>
                  <td className="px-3 py-2 text-foreground border-r border-border/50">{p.project_summary}</td>
                  <td className="px-3 py-2 text-foreground text-right border-r border-border/50">{formatMonthlyAmount(Number(p.sales_amount || 0))}</td>
                  <td className="px-3 py-2 text-muted-foreground">{p.note || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Section 3: 영업 현황 */}
      <div className="glass-card rounded-xl p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">영업 현황</h2>
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted">
                <th className="text-left px-3 py-2.5 font-semibold text-foreground border-r border-border/50">고객사명</th>
                <th className="text-left px-3 py-2.5 font-semibold text-foreground border-r border-border/50">프로젝트 명</th>
                <th className="text-left px-3 py-2.5 font-semibold text-foreground border-r border-border/50">프로젝트 내용</th>
                <th className="text-left px-3 py-2.5 font-semibold text-foreground border-r border-border/50">영업 진행사항</th>
                <th className="text-left px-3 py-2.5 font-semibold text-foreground border-r border-border/50">라이선스 및 공수</th>
                <th className="text-left px-3 py-2.5 font-semibold text-foreground">비고</th>
              </tr>
            </thead>
            <tbody>
              {filteredSalesProjects.length === 0 ? (
                <tr><td colSpan={5} className="py-8 text-center text-muted-foreground">데이터 없음</td></tr>
              ) : filteredSalesProjects.map((p) => (
                <tr key={p.id} className="border-b border-border/50 hover:bg-muted/30">
                  <td className="px-3 py-2 text-foreground border-r border-border/50">{p.client_name || '-'}</td>
                  <td className="px-3 py-2 text-foreground border-r border-border/50">{p.project_name}</td>
                  <td className="px-3 py-2 text-foreground border-r border-border/50">{p.project_summary}</td>
                  <td className="px-3 py-2 text-foreground border-r border-border/50">{p.sales_schedule_note || '-'}</td>
                  <td className="px-3 py-2 text-foreground border-r border-border/50">{p.effort || '-'}</td>
                  <td className="px-3 py-2 text-muted-foreground">{p.note || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
