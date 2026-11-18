// 환율·금리 provider: 네이버 증권 시장지표 JSON(비공식, API 키 불필요).
// 공식 API 키(EXIM, ECOS, FRED)가 없을 때 샘플 대신 실제 값을 보여 주기 위한 소스이며 1시간마다 읽는다.
// 키가 설정되면 등록 순서가 앞선 공식 API provider가 해당 항목을 맡는다.
//
// 아래 주소와 필드는 2026-11-18에 실제 응답을 받아 확인한 것이다(헤더 추가 없이 호출).
//   환율(하나은행 고시): GET https://api.stock.naver.com/marketindex/exchange/majors  → 배열, 한 번에 3종
//     { "reutersCode": "FX_USDKRW", "closePrice": "1,332.80", "fluctuations": "-2.70",
//       "fluctuationsRatio": "-0.20", "fluctuationsType": { "name": "FALLING" },
//       "localTradedAt": "2026-11-18T22:08:43+09:00" }   엔화(FX_JPYKRW)는 100엔 기준
//   국채 금리: GET https://api.stock.naver.com/marketindex/bond/{KR3YT=RR | US10YT=RR}
//     { "closePrice": "3.7460", "fluctuations": "0.0190", "fluctuationsType": { "name": "RISING" },
//       "localTradedAt": "2026-11-18T16:19:24+09:00" }   변동은 전일 종가 대비(%p)
//   기준금리: GET https://api.stock.naver.com/marketindex/standardInterest/{KOR | USA}
//     { "closePrice": "3.00",
//       "calendars": [{ "releaseDate": "20260827", "actualValue": 3, "changeValue": 0.25, "isRelease": true }] }
//     calendars는 최근 발표 7회분이며, 변경폭이 0이 아닌 가장 최근 발표를 "최근 변경"으로 쓴다.
// 형식이 달라지면 값을 추측하지 않고 format 오류를 내며, 수집기는 샘플 데이터로 전환한다.

import { assertOk, parseJson, SourceError, toNumber } from "../http.ts";
import { compactToYmd, kstYmd } from "../time.ts";
import type { Cadence, IndicatorProvider, IndicatorResult, ProviderContext } from "../types.ts";

const BASE = "https://api.stock.naver.com/marketindex";

/**
 * 네이버 시장지표는 하루에도 여러 번 바뀌는 값이므로 1시간마다 읽는다.
 * 한 번에 환율 1회, 국채 2회, 기준금리 2회로 시간당 5회 호출한다.
 */
const HOURLY: Cadence = { every: "hour" };

type Row = Record<string, unknown>;

async function getJson(ctx: ProviderContext, source: string, path: string): Promise<unknown> {
  const res = await ctx.http.get(`${BASE}/${path}`, { source });
  assertOk(res);
  return parseJson(res.text);
}

/** 방향 필드(RISING, FALLING)로 부호를 정한다. 그 외의 값이면 숫자의 부호를 그대로 쓴다 */
function signed(value: number, row: Row): number {
  const direction = (row.fluctuationsType as Row | undefined)?.name;
  if (direction === "FALLING") return -Math.abs(value);
  if (direction === "RISING") return Math.abs(value);
  return value;
}

/** 현재가, 전일 대비 변동, 기준시각을 읽는다 */
function readQuote(row: Row | undefined, label: string): { value: number; change: number; tradedAt: string } {
  const value = toNumber(row?.closePrice);
  const change = toNumber(row?.fluctuations);
  const tradedAt = typeof row?.localTradedAt === "string" ? Date.parse(row.localTradedAt) : Number.NaN;
  if (!row || value === null || change === null || Number.isNaN(tradedAt)) {
    throw new SourceError("format", `네이버 시장지표 응답에서 ${label}의 필수 필드를 찾지 못했습니다`);
  }
  return { value, change: signed(change, row), tradedAt: new Date(tradedAt).toISOString() };
}

// 환율 ---------------------------------------------------------------------

const FX_CODES: Record<string, string> = {
  usdkrw: "FX_USDKRW",
  jpykrw: "FX_JPYKRW",
  cnykrw: "FX_CNYKRW",
};

export const naverFxProvider: IndicatorProvider = {
  id: "naver-fx",
  envKey: null,
  itemIds: Object.keys(FX_CODES),
  cadence: HOURLY,

  async fetch(ctx, _apiKey, itemIds): Promise<IndicatorResult[]> {
    const rows = await getJson(ctx, this.id, "exchange/majors");
    if (!Array.isArray(rows)) throw new SourceError("format", "네이버 환율 응답이 배열이 아닙니다");

    return itemIds.map((id) => {
      const row = (rows as Row[]).find((r) => r?.reutersCode === FX_CODES[id]);
      const quote = readQuote(row, FX_CODES[id]);
      const pct = toNumber(row?.fluctuationsRatio);
      return {
        id,
        value: quote.value,
        change: quote.change,
        changePct: pct === null ? null : signed(pct, row as Row),
        changeKind: "prev",
        changedOn: null,
        asOf: quote.tradedAt,
        asOfPrecision: "minute",
      };
    });
  },
};

// 국채 금리 -----------------------------------------------------------------

function bondProvider(id: string, itemId: string, code: string): IndicatorProvider {
  return {
    id,
    envKey: null,
    itemIds: [itemId],
    cadence: HOURLY,

    async fetch(ctx): Promise<IndicatorResult[]> {
      const quote = readQuote((await getJson(ctx, id, `bond/${code}`)) as Row, code);
      return [
        {
          id: itemId,
          value: quote.value,
          change: quote.change,
          changePct: null,
          changeKind: "prev",
          changedOn: null,
          asOf: quote.tradedAt,
          asOfPrecision: "minute",
        },
      ];
    },
  };
}

/** 국고채 3년 */
export const naverKrBondProvider = bondProvider("naver-bond-kr", "ktb3y", "KR3YT=RR");

/** 미 국채 10년 */
export const naverUsBondProvider = bondProvider("naver-bond-us", "ust10y", "US10YT=RR");

// 기준금리 -------------------------------------------------------------------

const POLICY_NATIONS: Record<string, string> = {
  krBaseRate: "KOR",
  usPolicyRate: "USA",
};

/** 발표 이력에서 변경폭이 0이 아닌 가장 최근 발표를 찾는다 */
export function findLastPolicyChange(calendars: unknown): { changedOn: string; change: number } | null {
  if (!Array.isArray(calendars)) return null;
  const released = (calendars as Row[])
    .filter((c) => c?.isRelease === true && typeof c.releaseDate === "string" && c.releaseDate.length === 8)
    .sort((a, b) => (b.releaseDate as string).localeCompare(a.releaseDate as string));
  for (const entry of released) {
    const change = toNumber(entry.changeValue);
    if (change !== null && change !== 0) return { changedOn: compactToYmd(entry.releaseDate as string), change };
  }
  return null;
}

export const naverPolicyRateProvider: IndicatorProvider = {
  id: "naver-policy-rate",
  envKey: null,
  itemIds: Object.keys(POLICY_NATIONS),
  cadence: HOURLY,

  async fetch(ctx, _apiKey, itemIds): Promise<IndicatorResult[]> {
    const results: IndicatorResult[] = [];
    for (const id of itemIds) {
      const nation = POLICY_NATIONS[id];
      const row = (await getJson(ctx, this.id, `standardInterest/${nation}`)) as Row | null;
      const value = toNumber(row?.closePrice);
      if (!row || value === null || !Array.isArray(row.calendars)) {
        throw new SourceError("format", `네이버 기준금리 응답에서 ${nation}의 필수 필드를 찾지 못했습니다`);
      }
      const lastChange = findLastPolicyChange(row.calendars);
      results.push({
        id,
        value,
        change: lastChange?.change ?? null,
        changePct: null,
        changeKind: "policy",
        changedOn: lastChange?.changedOn ?? null,
        // 기준금리는 다음 결정 전까지 유지되는 값이므로 확인한 날짜를 기준일로 쓴다.
        asOf: kstYmd(ctx.now),
        asOfPrecision: "day",
      });
    }
    return results;
  },
};
