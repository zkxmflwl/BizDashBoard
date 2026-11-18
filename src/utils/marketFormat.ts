import type { IndicatorItem } from "@/types/market";

export type Trend = "up" | "down" | "flat";

export function trendOf(change: number | null): Trend {
  if (change === null || change === 0) return "flat";
  return change > 0 ? "up" : "down";
}

export function formatNumber(value: number, decimals: number): string {
  return value.toLocaleString("ko-KR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** +1.99, -0.74, 0.00 */
export function formatSigned(value: number, decimals: number): string {
  const text = formatNumber(Math.abs(value), decimals);
  if (value > 0) return `+${text}`;
  if (value < 0) return `-${text}`;
  return text;
}

const kstParts = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Seoul",
  hourCycle: "h23",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function toKst(iso: string): Record<string, string> | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const p: Record<string, string> = {};
  for (const part of kstParts.formatToParts(new Date(t))) p[part.type] = part.value;
  return p;
}

/** 데이터 기준시각. 분 단위는 "11/18 20:15 기준", 일 단위는 "11/18 기준" */
export function formatAsOf(item: Pick<IndicatorItem, "asOf" | "asOfPrecision">): string | null {
  if (!item.asOf) return null;
  if (item.asOfPrecision === "day") {
    const [, m, d] = item.asOf.split("-");
    return m && d ? `${m}/${d} 기준` : null;
  }
  const p = toKst(item.asOf);
  return p ? `${p.month}/${p.day} ${p.hour}:${p.minute} 기준` : null;
}

/** HH:MM:SS (KST) */
export function formatClock(iso: string | number | null | undefined): string {
  if (iso === null || iso === undefined || iso === "") return "-";
  const p = toKst(typeof iso === "number" ? new Date(iso).toISOString() : iso);
  return p ? `${p.hour}:${p.minute}:${p.second}` : "-";
}
