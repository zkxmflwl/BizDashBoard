import type { Session } from "./types.ts";

export const KST = "Asia/Seoul";

export interface ZonedParts {
  /** YYYY-MM-DD */
  ymd: string;
  /** 0(일)~6(토) */
  weekday: number;
  /** 자정부터 지난 분 */
  minutes: number;
  /** HH:MM:SS */
  hms: string;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const formatters = new Map<string, Intl.DateTimeFormat>();

/** 주어진 시각을 특정 시간대의 달력 값으로 풀어낸다. 서머타임은 Intl이 처리한다 */
export function zonedParts(date: Date, timeZone: string): ZonedParts {
  let fmt = formatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    formatters.set(timeZone, fmt);
  }
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) p[part.type] = part.value;
  return {
    ymd: `${p.year}-${p.month}-${p.day}`,
    weekday: WEEKDAYS.indexOf(p.weekday),
    minutes: Number(p.hour) * 60 + Number(p.minute),
    hms: `${p.hour}:${p.minute}:${p.second}`,
  };
}

export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** 평일이고 개장~마감 시각(양 끝 포함) 안이면 true. 공휴일은 원천 응답의 개장 여부로 구분한다 */
export function isSessionOpen(now: Date, session: Session): boolean {
  const z = zonedParts(now, session.timeZone);
  if (z.weekday < 1 || z.weekday > 5) return false;
  return z.minutes >= hhmmToMinutes(session.open) && z.minutes <= hhmmToMinutes(session.close);
}

/** 시각을 ms 길이의 구간 번호로 바꾼다. 같은 구간에서는 원천을 다시 호출하지 않는다 */
export function slotOf(at: Date | string | null, ms: number): number | null {
  if (at === null) return null;
  const t = typeof at === "string" ? Date.parse(at) : at.getTime();
  return Number.isNaN(t) ? null : Math.floor(t / ms);
}

export function kstYmd(date: Date): string {
  return zonedParts(date, KST).ymd;
}

/** KST 기준 날짜와 시각(HH:MM)을 Date로 만든다 */
export function kstDateAt(ymd: string, hhmm: string): Date {
  return new Date(`${ymd}T${hhmm}:00+09:00`);
}

export function addDaysYmd(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

/** 20261118 → 2026-11-18 */
export function compactToYmd(compact: string): string {
  return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
}

export function ymdToCompact(ymd: string): string {
  return ymd.replace(/-/g, "");
}

/** 로그용 KST 시각 */
export function formatKst(date: Date): string {
  const z = zonedParts(date, KST);
  return `${z.ymd} ${z.hms} KST`;
}
