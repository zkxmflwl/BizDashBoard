import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useYearlyMonthlySummary } from '@/hooks/useYearlyMonthlySummary';
import { formatKRWShort } from '@/data/mockData';
import { Loader2 } from 'lucide-react';

interface Props {
  year: string;
  departmentCodes?: string[]; // 비어있으면 전체
  mode?: 'cumulative' | 'monthly'; // 누적 or 당월
  activeMonth?: string;
}

export default function MonthlyBarChart({ year, departmentCodes, mode = 'cumulative', activeMonth }: Props) {
  const { data: rawData, isLoading } = useYearlyMonthlySummary(year, departmentCodes);

  const data = useMemo(() => {
    if (!rawData) return rawData;

    // 기준 월까지만 자르기
    const cutoff = activeMonth ?? `${year}-12`;

    if (mode === 'cumulative') {
      let cumSales = 0;
      let cumPurchase = 0;
      return rawData.map((d) => {
        const isJanuary = d.month_key.endsWith('-01');
        const isActive = d.month_key <= cutoff;

        if (isActive) {
          // 1월이면 이연 매출/매입을 더함
          cumSales += d.sales + (isJanuary ? d.deferredSales : 0);
          cumPurchase += d.purchase + (isJanuary ? d.deferredPurchase : 0);
        }

        return {
          ...d,
          sales: isActive ? cumSales : 0,
          purchase: isActive ? cumPurchase : 0,
          netSales: isActive ? cumSales - cumPurchase : 0,
        };
      });
    }

    // monthly: cutoff 이후 월은 0으로
    return rawData.map((d) => ({
      ...d,
      sales: d.month_key <= cutoff ? d.sales : 0,
      purchase: d.month_key <= cutoff ? d.purchase : 0,
      netSales: d.month_key <= cutoff ? d.netSales : 0,
    }));
  }, [rawData, mode, activeMonth, year]);

  const yDomain = useMemo<[number, number]>(() => {
    if (!data || data.length === 0) return [0, 0];
    const STEP = 5_000_000_000; // 50억 단위
    let min = 0;
    let max = 0;
    for (const d of data) {
      min = Math.min(min, d.sales, d.purchase, d.netSales);
      max = Math.max(max, d.sales, d.purchase, d.netSales);
    }
    const maxRounded = max > 0 ? Math.ceil(max / STEP) * STEP : 0;
    const minRounded = min < 0 ? Math.floor(min / STEP) * STEP : 0;
    return [minRounded, maxRounded];
  }, [data]);

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </div>
    );
  }

  if (!data || data.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">데이터 없음</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={350}>
      <BarChart data={data} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="label" tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }} />
        <YAxis
          domain={yDomain}
          tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
          tickFormatter={(v: number) => formatKRWShort(v)}
          width={70}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: 'hsl(var(--card))',
            border: '1px solid hsl(var(--border))',
            borderRadius: '8px',
            fontSize: '12px',
          }}
          formatter={(value: number, name: string) => [formatKRWShort(value), name]}
        />
        <Legend wrapperStyle={{ fontSize: '12px' }} />
        <Bar dataKey="sales" name="매출" fill="#7DA6FF" radius={[3, 3, 0, 0]} />
        <Bar dataKey="purchase" name="매입" fill="#FF9E9E" radius={[3, 3, 0, 0]} />
        <Bar dataKey="netSales" name="순매출" fill="#7ED6B2" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
