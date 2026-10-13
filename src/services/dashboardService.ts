import { supabase } from '@/integrations/supabase/client';
import { fetchActiveProjectCount, fetchMonthlyOrderCount, fetchActiveProjectsByDept, fetchMonthlyOrdersByDept } from './businessProjectService';
import { fetchSalesSummary, fetchYtdByDepartment, fetchYtdSummary } from './salesService';

export interface DashboardStats {
  ytdSales: number;
  ytdPurchase: number;
  ytdNetSales: number;
  prevYtdSales: number;
  prevYtdPurchase: number;
  prevYtdNetSales: number;
  activeProjectCount: number;
  monthlyOrderCount: number;
}

export interface DeptSummaryRow {
  departmentName: string;
  departmentCode: string;
  monthlySales: number;
  monthlyPurchase: number;
  monthlyNetSales: number;
  prevMonthlySales: number | null;
  prevMonthlyPurchase: number | null;
  prevMonthlyNetSales: number | null;
  ytdSales: number;
  ytdPurchase: number;
  ytdNetSales: number;
  /** 전년 동기 누적 (신설 부서는 null) */
  prevYtdSales: number | null;
  prevYtdPurchase: number | null;
  /** 전년 동기 대비 매출 증감. 신설 부서는 null, 모부서는 승계 부서 당해 실적을 합산해 계산 */
  yoyChange: number | null;
  /** yoyChange에 합산된 승계 부서명 (예: ['AIP사업부']) */
  yoyIncludes: string[];
  /** 신설·분리 시점 (YYYY-MM) */
  establishedMonth: string | null;
  /** 제한 부서(자회사) 여부 */
  isRestricted: boolean;
  activeProjects: number;
  monthlyOrders: number;
}

interface DeptMeta {
  department_code: string;
  department_name: string;
  sort_order: number | null;
  predecessor_code: string | null;
  established_month: string | null;
  is_restricted: boolean;
}

/**
 * 설립·분리 시점이 전년 1월보다 뒤이면 전년 동기 누적이 존재하지 않는 신설 부서로 본다.
 * 예) 2026년 조회: established_month '2026-01' → 신설, '2025-01' → 정상 비교
 */
export function isNewDepartment(establishedMonth: string | null | undefined, year: number): boolean {
  return !!establishedMonth && establishedMonth > `${year - 1}-01`;
}

function sumYtd(rows: { month_key?: string; sales_amount?: number | null; purchase_amount?: number | null; deferred_sales?: number | null; deferred_purchase?: number | null }[]) {
  let sales = 0;
  let purchase = 0;
  for (const r of rows) {
    const isJanuary = r.month_key?.endsWith('-01');
    sales += Number(r.sales_amount || 0) + (isJanuary ? Number(r.deferred_sales || 0) : 0);
    purchase += Number(r.purchase_amount || 0) + (isJanuary ? Number(r.deferred_purchase || 0) : 0);
  }
  return { sales, purchase };
}

export async function fetchDashboardStats(monthKey: string): Promise<DashboardStats> {
  const [y, m] = monthKey.split('-').map(Number);
  const year = String(y);
  const prevYearMonthKey = `${y - 1}-${String(m).padStart(2, '0')}`;

  const [ytdData, prevYtdData, activeProjectCount, monthlyOrderCount] = await Promise.all([
    fetchYtdSummary(year, monthKey),
    fetchYtdSummary(String(y - 1), prevYearMonthKey),
    fetchActiveProjectCount(monthKey),
    fetchMonthlyOrderCount(monthKey),
  ]);

  const cur = sumYtd(ytdData);
  const prev = sumYtd(prevYtdData);

  return {
    ytdSales: cur.sales,
    ytdPurchase: cur.purchase,
    ytdNetSales: cur.sales - cur.purchase,
    prevYtdSales: prev.sales,
    prevYtdPurchase: prev.purchase,
    prevYtdNetSales: prev.sales - prev.purchase,
    activeProjectCount,
    monthlyOrderCount,
  };
}

export async function fetchDeptSummary(monthKey: string): Promise<DeptSummaryRow[]> {
  const year = monthKey.split('-')[0];
  const [y, m] = monthKey.split('-').map(Number);
  const prevMonthKey = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  const prevYearSameMonthKey = `${y - 1}-${String(m).padStart(2, '0')}`;

  const [monthlyData, prevMonthData, ytdData, prevYearYtdData, activeByDept, ordersByDept, deptMetaRes] = await Promise.all([
    fetchSalesSummary(monthKey),
    fetchSalesSummary(prevMonthKey),
    fetchYtdByDepartment(year.toString(), monthKey),
    fetchYtdByDepartment(String(y - 1), prevYearSameMonthKey),
    fetchActiveProjectsByDept(monthKey),
    fetchMonthlyOrdersByDept(monthKey),
    supabase
      .from('departments')
      .select('department_code, department_name, sort_order, predecessor_code, established_month, is_restricted')
      .eq('is_active', true),
  ]);

  const deptMeta = new Map<string, DeptMeta>();
  for (const d of (deptMetaRes.data || []) as DeptMeta[]) {
    deptMeta.set(d.department_code, d);
  }

  // Previous month map
  const prevMap = new Map<string, { sales: number; purchase: number }>();
  for (const r of prevMonthData) {
    prevMap.set(r.department_code, {
      sales: Number(r.sales_amount || 0),
      purchase: Number(r.purchase_amount || 0),
    });
  }

  const emptyRow = (code: string, name: string): DeptSummaryRow => {
    const prev = prevMap.get(code);
    return {
      departmentCode: code,
      departmentName: name,
      monthlySales: 0,
      monthlyPurchase: 0,
      monthlyNetSales: 0,
      prevMonthlySales: prev ? prev.sales : null,
      prevMonthlyPurchase: prev ? prev.purchase : null,
      prevMonthlyNetSales: prev ? prev.sales - prev.purchase : null,
      ytdSales: 0,
      ytdPurchase: 0,
      ytdNetSales: 0,
      prevYtdSales: null,
      prevYtdPurchase: null,
      yoyChange: null,
      yoyIncludes: [],
      establishedMonth: null,
      isRestricted: false,
      activeProjects: 0,
      monthlyOrders: 0,
    };
  };

  // Build department map
  const depts = new Map<string, DeptSummaryRow>();

  // Monthly
  for (const r of monthlyData) {
    const name = r.departments?.department_name || r.department_code;
    const row = emptyRow(r.department_code, name);
    row.monthlySales = Number(r.sales_amount || 0);
    row.monthlyPurchase = Number(r.purchase_amount || 0);
    row.monthlyNetSales = row.monthlySales - row.monthlyPurchase;
    depts.set(r.department_code, row);
  }

  // YTD (1월 행의 이월 매출·매입 포함)
  for (const r of ytdData) {
    const name = r.departments?.department_name || r.department_code;
    if (!depts.has(r.department_code)) {
      depts.set(r.department_code, emptyRow(r.department_code, name));
    }
    const d = depts.get(r.department_code)!;
    const isJanuary = r.month_key?.endsWith('-01');
    d.ytdSales += Number(r.sales_amount || 0) + (isJanuary ? Number(r.deferred_sales || 0) : 0);
    d.ytdPurchase += Number(r.purchase_amount || 0) + (isJanuary ? Number(r.deferred_purchase || 0) : 0);
    d.ytdNetSales = d.ytdSales - d.ytdPurchase;
  }

  // 전년 동기 누적 (부서별)
  const prevYearSales = new Map<string, number>();
  const prevYearPurchase = new Map<string, number>();
  for (const r of prevYearYtdData) {
    const isJanuary = r.month_key?.endsWith('-01');
    prevYearSales.set(
      r.department_code,
      (prevYearSales.get(r.department_code) || 0) + Number(r.sales_amount || 0) + (isJanuary ? Number(r.deferred_sales || 0) : 0),
    );
    prevYearPurchase.set(
      r.department_code,
      (prevYearPurchase.get(r.department_code) || 0) + Number(r.purchase_amount || 0) + (isJanuary ? Number(r.deferred_purchase || 0) : 0),
    );
  }

  // 승계 관계: 전년 기준이 없는 신설·분리 부서의 당해 누적을 모부서 YoY에 합산
  const successorsByParent = new Map<string, string[]>();
  for (const meta of deptMeta.values()) {
    if (meta.predecessor_code && isNewDepartment(meta.established_month, y)) {
      const list = successorsByParent.get(meta.predecessor_code) || [];
      list.push(meta.department_code);
      successorsByParent.set(meta.predecessor_code, list);
    }
  }

  // YoY (전년 동기 누적 대비)
  for (const [code, d] of depts) {
    const meta = deptMeta.get(code);
    d.establishedMonth = meta?.established_month ?? null;
    d.isRestricted = meta?.is_restricted ?? false;

    if (isNewDepartment(meta?.established_month, y)) {
      // 신설·분리 부서: 전년 동기 데이터가 없으므로 비교하지 않음
      d.prevYtdSales = null;
      d.prevYtdPurchase = null;
      d.yoyChange = null;
      d.yoyIncludes = [];
      continue;
    }

    d.prevYtdSales = prevYearSales.get(code) ?? 0;
    d.prevYtdPurchase = prevYearPurchase.get(code) ?? 0;

    let ytdForYoy = d.ytdSales;
    const includes: string[] = [];
    for (const succCode of successorsByParent.get(code) || []) {
      const succ = depts.get(succCode);
      if (succ) {
        ytdForYoy += succ.ytdSales;
        includes.push(succ.departmentName);
      }
    }
    d.yoyChange = ytdForYoy - d.prevYtdSales;
    d.yoyIncludes = includes;
  }

  // Active projects & monthly orders
  for (const [code, count] of Object.entries(activeByDept)) {
    if (depts.has(code)) {
      depts.get(code)!.activeProjects = count;
    }
  }
  for (const [code, count] of Object.entries(ordersByDept)) {
    if (depts.has(code)) {
      depts.get(code)!.monthlyOrders = count;
    }
  }

  // Sort by department sort_order (ascending)
  return Array.from(depts.values()).sort((a, b) => {
    const aOrder = deptMeta.get(a.departmentCode)?.sort_order ?? 9999;
    const bOrder = deptMeta.get(b.departmentCode)?.sort_order ?? 9999;
    return aOrder - bOrder;
  });
}
