// 환율 provider: 한국수출입은행 현재환율 API(AP01, 매매기준율).
// 명세 출처: https://www.koreaexim.go.kr/ir/HPHKIR020M01?apino=2&viewtype=C (2026-11-18 확인)
//   요청: https://oapi.koreaexim.go.kr/site/program/financial/exchangeJSON?authkey=..&searchdate=YYYYMMDD&data=AP01
//   응답: [{ "result": 1, "cur_unit": "USD", "deal_bas_r": "1,066.9", ... }]
//   result: 1 성공, 2 DATA 코드 오류, 3 인증코드 오류, 4 일일 제한횟수 마감(하루 1000회)
//   비영업일이거나 영업일 11시 이전이면 해당일 데이터가 비어 있다.
//
// "직전 거래일 대비"는 달력으로 계산하지 않는다. 오늘부터 하루씩 거슬러 올라가며
// 실제로 고시된 날짜 두 개를 찾아 그 둘을 비교한다(주말과 공휴일이 자동으로 걸러진다).

import { assertOk, parseJson, round, SourceError, toNumber } from "../http.ts";
import { addDaysYmd, kstYmd, ymdToCompact } from "../time.ts";
import type { IndicatorProvider, IndicatorResult, ProviderContext } from "../types.ts";

const ENDPOINT = "https://oapi.koreaexim.go.kr/site/program/financial/exchangeJSON";

/** 연휴를 감안해 거슬러 올라가는 최대 일수 */
const MAX_LOOKBACK_DAYS = 12;

/** 항목 id와 수출입은행 통화코드. 위안화는 CNH, 엔화는 100엔 단위로 제공된다 */
const UNITS: Record<string, string> = {
  usdkrw: "USD",
  jpykrw: "JPY(100)",
  cnykrw: "CNH",
};

function resultError(result: unknown): SourceError {
  if (result === 2) return new SourceError("format", "수출입은행 API: DATA 코드 오류");
  if (result === 3) return new SourceError("auth", "수출입은행 API: 인증키 오류(만료되었을 수 있습니다)");
  if (result === 4) return new SourceError("transient", "수출입은행 API: 일일 호출 제한을 넘었습니다");
  return new SourceError("format", `수출입은행 API: 알 수 없는 result 값(${String(result)})`);
}

interface Observation {
  date: string;
  rates: Record<string, number>;
}

export const eximFxProvider: IndicatorProvider = {
  id: "exim-fx",
  envKey: "EXIM_API_KEY",
  itemIds: Object.keys(UNITS),
  // 영업일 11시 전후에 고시되므로 그 뒤에 한 번 수집한다.
  cadence: { every: "day", atKst: "11:30" },

  async fetch(ctx: ProviderContext, apiKey: string): Promise<IndicatorResult[]> {
    const found: Observation[] = [];
    let day = kstYmd(ctx.now);

    for (let i = 0; i < MAX_LOOKBACK_DAYS && found.length < 2; i += 1, day = addDaysYmd(day, -1)) {
      const date = ymdToCompact(day);
      const res = await ctx.http.get(
        `${ENDPOINT}?authkey=${encodeURIComponent(apiKey)}&searchdate=${date}&data=AP01`,
        { source: this.id, logUrl: `${ENDPOINT}?authkey=***&searchdate=${date}&data=AP01` },
      );
      assertOk(res);

      const rows = parseJson(res.text);
      if (rows === null || (Array.isArray(rows) && rows.length === 0)) continue; // 고시가 없는 날
      if (!Array.isArray(rows)) throw new SourceError("format", "수출입은행 API: 응답이 배열이 아닙니다");

      const result = (rows[0] as { result?: unknown }).result;
      if (result !== 1) throw resultError(result);

      const rates: Record<string, number> = {};
      for (const [id, unit] of Object.entries(UNITS)) {
        const row = (rows as Record<string, unknown>[]).find((r) => r.cur_unit === unit);
        const rate = toNumber(row?.deal_bas_r);
        if (rate === null) throw new SourceError("format", `수출입은행 API: ${unit}의 매매기준율이 없습니다`);
        rates[id] = rate;
      }
      found.push({ date: day, rates });
    }

    if (found.length === 0) {
      throw new SourceError("transient", `최근 ${MAX_LOOKBACK_DAYS}일 안에 고시된 환율이 없습니다`);
    }

    const [latest, previous] = found;
    return this.itemIds.map((id) => {
      const value = latest.rates[id];
      const before = previous?.rates[id];
      const change = before === undefined ? null : round(value - before, 2);
      return {
        id,
        value,
        change,
        changePct: change === null || !before ? null : round((change / before) * 100, 2),
        changeKind: "prev",
        changedOn: null,
        asOf: latest.date,
      };
    });
  },
};
