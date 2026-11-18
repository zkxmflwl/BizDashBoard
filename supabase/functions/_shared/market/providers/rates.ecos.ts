// 한국 금리 provider: 한국은행 ECOS Open API(StatisticSearch).
// 형식: https://ecos.bok.or.kr/api/StatisticSearch/{인증키}/json/kr/{시작건}/{종료건}/{통계표}/{주기}/{시작일}/{종료일}/{항목}
// 통계표와 항목 코드는 2026-11-18에 StatisticItemList와 StatisticSearch 응답으로 확인했다.
//   722Y001 / 0101000   : 1.3.1. 한국은행 기준금리 및 여수신금리 > 한국은행 기준금리 (일별 제공)
//   817Y002 / 010200000 : 1.3.2.1. 시장금리(일별) > 국고채(3년)
// 응답: { "StatisticSearch": { "list_total_count": n, "row": [{ "TIME": "20261105", "DATA_VALUE": "3.669" }] } }
// 오류: { "RESULT": { "CODE": "INFO-200", "MESSAGE": "해당하는 데이터가 없습니다." } }
// 행은 TIME 오름차순으로 온다.

import { assertOk, parseJson, round, SourceError, toNumber } from "../http.ts";
import { addDaysYmd, compactToYmd, kstYmd, ymdToCompact } from "../time.ts";
import type { IndicatorProvider, IndicatorResult, ProviderContext } from "../types.ts";

const BASE = "https://ecos.bok.or.kr/api/StatisticSearch";

const BASE_RATE = { stat: "722Y001", item: "0101000" };
const KTB_3Y = { stat: "817Y002", item: "010200000" };

/** 기준금리 변경일을 찾기 위해 뒤에서부터 읽는 한 쪽의 크기와 최대 쪽수(약 10년) */
const PAGE_SIZE = 800;
const MAX_PAGES = 5;

interface Point {
  /** YYYY-MM-DD */
  date: string;
  value: number;
}

interface Series {
  total: number;
  points: Point[];
}

async function fetchSeries(
  ctx: ProviderContext,
  apiKey: string,
  source: string,
  series: { stat: string; item: string },
  range: { from: number; to: number; start: string; end: string },
): Promise<Series> {
  const tail = `json/kr/${range.from}/${range.to}/${series.stat}/D/${range.start}/${range.end}/${series.item}`;
  const res = await ctx.http.get(`${BASE}/${encodeURIComponent(apiKey)}/${tail}`, {
    source,
    logUrl: `${BASE}/***/${tail}`,
  });
  assertOk(res);

  const body = parseJson(res.text) as {
    StatisticSearch?: { list_total_count?: unknown; row?: unknown };
    RESULT?: { CODE?: string; MESSAGE?: string };
  } | null;

  if (body?.RESULT) {
    const code = body.RESULT.CODE ?? "";
    const message = (body.RESULT.MESSAGE ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
    if (code === "INFO-200") return { total: 0, points: [] }; // 데이터 없음
    if (code === "INFO-100") throw new SourceError("auth", `ECOS: 인증키가 유효하지 않습니다(${message})`);
    throw new SourceError("transient", `ECOS: ${code} ${message}`);
  }

  const rows = body?.StatisticSearch?.row;
  if (!Array.isArray(rows)) throw new SourceError("format", "ECOS 응답에 StatisticSearch.row가 없습니다");

  const points: Point[] = [];
  for (const row of rows as Record<string, unknown>[]) {
    const value = toNumber(row.DATA_VALUE);
    if (typeof row.TIME !== "string" || row.TIME.length !== 8 || value === null) {
      throw new SourceError("format", "ECOS 응답 행에 TIME 또는 DATA_VALUE가 없습니다");
    }
    points.push({ date: compactToYmd(row.TIME), value });
  }
  return { total: toNumber(body?.StatisticSearch?.list_total_count) ?? points.length, points };
}

/** 가장 최근에 값이 바뀐 지점을 찾는다. points는 날짜 오름차순 */
export function findLastChange(points: Point[]): { changedOn: string; change: number } | null {
  for (let i = points.length - 1; i > 0; i -= 1) {
    if (points[i].value !== points[i - 1].value) {
      return { changedOn: points[i].date, change: round(points[i].value - points[i - 1].value, 3) };
    }
  }
  return null;
}

export const ecosRatesProvider: IndicatorProvider = {
  id: "ecos-rates",
  envKey: "ECOS_API_KEY",
  itemIds: ["krBaseRate", "ktb3y"],
  // 시장금리(일별)는 당일 저녁에 반영된다.
  cadence: { every: "day", atKst: "18:30" },

  async fetch(ctx: ProviderContext, apiKey: string): Promise<IndicatorResult[]> {
    const today = kstYmd(ctx.now);
    const end = ymdToCompact(today);

    // 1) 기준금리: 전일 대비가 아니라 "최근 변경일 + 변경폭"을 구한다.
    //    일별 시계열을 뒤에서부터 읽어 값이 달라지는 지점을 찾는다.
    const start10y = ymdToCompact(addDaysYmd(today, -3650));
    const head = await fetchSeries(ctx, apiKey, this.id, BASE_RATE, { from: 1, to: 1, start: start10y, end });
    if (head.total === 0) throw new SourceError("format", "ECOS: 기준금리 시계열이 비어 있습니다");

    let points: Point[] = [];
    let hi = head.total;
    let lastChange: ReturnType<typeof findLastChange> = null;
    for (let page = 0; page < MAX_PAGES && hi >= 1; page += 1) {
      const lo = Math.max(1, hi - PAGE_SIZE + 1);
      const chunk = await fetchSeries(ctx, apiKey, this.id, BASE_RATE, { from: lo, to: hi, start: start10y, end });
      points = chunk.points.concat(points);
      lastChange = findLastChange(points);
      if (lastChange || lo === 1) break;
      hi = lo - 1;
    }
    const latestBase = points[points.length - 1];
    if (!latestBase) throw new SourceError("format", "ECOS: 기준금리 값을 읽지 못했습니다");

    // 2) 국고채 3년: 최근 관측치 두 개를 비교한다.
    const start40d = ymdToCompact(addDaysYmd(today, -40));
    const ktb = await fetchSeries(ctx, apiKey, this.id, KTB_3Y, { from: 1, to: 60, start: start40d, end });
    const latestKtb = ktb.points[ktb.points.length - 1];
    const prevKtb = ktb.points[ktb.points.length - 2];
    if (!latestKtb) throw new SourceError("format", "ECOS: 국고채 3년 값을 읽지 못했습니다");

    return [
      {
        id: "krBaseRate",
        value: latestBase.value,
        change: lastChange?.change ?? null,
        changePct: null,
        changeKind: "policy",
        changedOn: lastChange?.changedOn ?? null,
        asOf: latestBase.date,
      },
      {
        id: "ktb3y",
        value: latestKtb.value,
        change: prevKtb ? round(latestKtb.value - prevKtb.value, 3) : null,
        changePct: null,
        changeKind: "prev",
        changedOn: null,
        asOf: latestKtb.date,
      },
    ];
  },
};
