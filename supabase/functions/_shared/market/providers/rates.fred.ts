// 미국 금리 provider: FRED API(fred/series/observations).
// 명세 출처: https://fred.stlouisfed.org/docs/api/fred/series_observations.html (2026-11-18 확인)
//   요청: https://api.stlouisfed.org/fred/series/observations?series_id=..&api_key=..&file_type=json&sort_order=desc&limit=n
//   응답: { "observations": [{ "date": "2026-11-17", "value": "4.12" }] }  값은 문자열이며 limit 최대 100000
// 시리즈
//   DFEDTARU : 연방기금금리 목표범위 상단(일별). 미국 기준금리로 표시한다
//              값이 바뀌는 날짜는 FOMC 발표일이 아니라 적용일(보통 발표 다음 날)이다
//   DGS10    : 미 국채 10년 만기 수익률(일별)
// 휴장일의 값은 숫자가 아닌 문자열로 오므로 숫자로 읽히는 관측치만 쓴다.

import { parseJson, round, SourceError, toNumber } from "../http.ts";
import type { IndicatorProvider, IndicatorResult, ProviderContext } from "../types.ts";

const ENDPOINT = "https://api.stlouisfed.org/fred/series/observations";

interface Point {
  date: string;
  value: number;
}

/** 최신순으로 정렬된 관측치를 돌려준다 */
async function fetchObservations(
  ctx: ProviderContext,
  apiKey: string,
  source: string,
  seriesId: string,
  limit: number,
): Promise<Point[]> {
  const query = `series_id=${seriesId}&file_type=json&sort_order=desc&limit=${limit}`;
  const res = await ctx.http.get(`${ENDPOINT}?${query}&api_key=${encodeURIComponent(apiKey)}`, {
    source,
    logUrl: `${ENDPOINT}?${query}&api_key=***`,
  });

  if (res.status !== 200) {
    let message = `HTTP ${res.status}`;
    try {
      const body = parseJson(res.text) as { error_message?: string } | null;
      if (body?.error_message) message = body.error_message;
    } catch {
      // 오류 본문이 JSON이 아니면 상태 코드만 남긴다.
    }
    if (res.status === 400 && /api_key/i.test(message)) throw new SourceError("auth", `FRED: ${message}`);
    if (res.status === 429 || res.status >= 500) throw new SourceError("transient", `FRED: ${message}`);
    throw new SourceError("format", `FRED: ${message}`);
  }

  const body = parseJson(res.text) as { observations?: unknown } | null;
  if (!Array.isArray(body?.observations)) throw new SourceError("format", "FRED 응답에 observations가 없습니다");

  const points: Point[] = [];
  for (const row of body.observations as Record<string, unknown>[]) {
    const value = toNumber(row.value);
    if (typeof row.date === "string" && value !== null) points.push({ date: row.date, value });
  }
  if (points.length === 0) throw new SourceError("format", `FRED: ${seriesId}에 숫자 관측치가 없습니다`);
  return points;
}

export const fredRatesProvider: IndicatorProvider = {
  id: "fred-rates",
  envKey: "FRED_API_KEY",
  itemIds: ["usPolicyRate", "ust10y"],
  // 전 영업일 값이 미국 오후에 게시되므로 한국 시각 아침에 한 번 수집한다.
  cadence: { every: "day", atKst: "07:30" },

  async fetch(ctx: ProviderContext, apiKey: string): Promise<IndicatorResult[]> {
    // 기준금리: 약 7년치를 최신순으로 받아 값이 달라지는 첫 지점을 최근 변경으로 본다.
    const policy = await fetchObservations(ctx, apiKey, this.id, "DFEDTARU", 2600);
    let changedOn: string | null = null;
    let change: number | null = null;
    for (let i = 0; i < policy.length - 1; i += 1) {
      if (policy[i].value !== policy[i + 1].value) {
        changedOn = policy[i].date;
        change = round(policy[i].value - policy[i + 1].value, 3);
        break;
      }
    }

    // 국채 10년: 최근 관측치 두 개를 비교한다.
    const [latest, previous] = await fetchObservations(ctx, apiKey, this.id, "DGS10", 10);

    return [
      {
        id: "usPolicyRate",
        value: policy[0].value,
        change,
        changePct: null,
        changeKind: "policy",
        changedOn,
        asOf: policy[0].date,
      },
      {
        id: "ust10y",
        value: latest.value,
        change: previous ? round(latest.value - previous.value, 3) : null,
        changePct: null,
        changeKind: "prev",
        changedOn: null,
        asOf: latest.date,
      },
    ];
  },
};
