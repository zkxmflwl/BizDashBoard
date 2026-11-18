// 증시 지수 provider: 네이버 증권 polling JSON(비공식).
// 추후 한국투자증권 Open API로 교체할 때는 같은 StockIndexProvider 인터페이스를 구현한 파일을
// 추가하고 providers/index.ts의 등록 한 줄만 바꾼다.
//
// 아래 필드 매핑은 2026-11-18에 실제 응답을 받아 확인한 것이다.
//   { "datas": [ {
//       "itemCode": "KOSPI",                      // 해외 지수는 "reutersCode": ".IXIC"
//       "closePriceRaw": "5067.44",                // 현재가(장 마감 후에는 종가)
//       "compareToPreviousClosePriceRaw": "98.96", // 전일 종가 대비(하락이면 음수)
//       "compareToPreviousPrice": { "name": "RISING" | "FALLING" },
//       "fluctuationsRatioRaw": "1.99",            // 등락률(%)
//       "marketStatus": "CLOSE",                   // 장중 값은 장중에 확인이 필요하다
//       "localTradedAt": "2026-11-18T20:15:00+09:00"
//   } ] }
// 형식이 달라지면 값을 추측하지 않고 format 오류를 내며, 수집기는 샘플 데이터로 전환한다.

import { assertOk, parseJson, SourceError, toNumber } from "../http.ts";
import type { IndexQuote, ProviderContext, StockIndexProvider } from "../types.ts";

const BASE = "https://polling.finance.naver.com/api/realtime";

interface Symbol {
  /** 같은 path의 코드는 쉼표로 묶어 한 번에 조회한다 */
  path: "domestic/index" | "worldstock/index";
  code: string;
  /** 응답에서 항목을 식별하는 필드 */
  keyField: "itemCode" | "reutersCode";
}

const SYMBOLS: Record<string, Symbol> = {
  kospi: { path: "domestic/index", code: "KOSPI", keyField: "itemCode" },
  kosdaq: { path: "domestic/index", code: "KOSDAQ", keyField: "itemCode" },
  nasdaq: { path: "worldstock/index", code: ".IXIC", keyField: "reutersCode" },
};

type Row = Record<string, unknown>;

function toQuote(id: string, row: Row): IndexQuote {
  const value = toNumber(row.closePriceRaw) ?? toNumber(row.closePrice);
  const diff = toNumber(row.compareToPreviousClosePriceRaw) ?? toNumber(row.compareToPreviousClosePrice);
  const pct = toNumber(row.fluctuationsRatioRaw) ?? toNumber(row.fluctuationsRatio);
  const tradedAt = typeof row.localTradedAt === "string" ? Date.parse(row.localTradedAt) : Number.NaN;
  const marketStatus = row.marketStatus;

  if (value === null || diff === null || pct === null || Number.isNaN(tradedAt) || typeof marketStatus !== "string") {
    throw new SourceError("format", `네이버 지수 응답에서 ${id}의 필수 필드를 찾지 못했습니다`);
  }

  // 부호는 방향 필드를 우선한다. 확인된 값(RISING, FALLING)이 아니면 숫자의 부호를 그대로 쓴다.
  const direction = (row.compareToPreviousPrice as Row | undefined)?.name;
  const sign = direction === "FALLING" ? -1 : direction === "RISING" ? 1 : 0;

  return {
    id,
    value,
    change: sign === 0 ? diff : sign * Math.abs(diff),
    changePct: sign === 0 ? pct : sign * Math.abs(pct),
    asOf: new Date(tradedAt).toISOString(),
    // 마감으로 확인된 값은 "CLOSE"뿐이다. 그 외의 값은 개장 중으로 본다.
    marketOpen: marketStatus !== "CLOSE",
  };
}

export const naverStockIndexProvider: StockIndexProvider = {
  id: "naver-index",

  async fetchQuotes(itemIds: string[], ctx: ProviderContext): Promise<IndexQuote[]> {
    const byPath = new Map<string, string[]>();
    for (const id of itemIds) {
      const symbol = SYMBOLS[id];
      if (!symbol) throw new SourceError("format", `네이버 지수 코드가 정의되지 않은 항목입니다: ${id}`);
      byPath.set(symbol.path, [...(byPath.get(symbol.path) ?? []), id]);
    }

    const quotes: IndexQuote[] = [];
    for (const [path, ids] of byPath) {
      const url = `${BASE}/${path}/${ids.map((id) => SYMBOLS[id].code).join(",")}`;
      const res = await ctx.http.get(url, { source: this.id });
      assertOk(res);

      const body = parseJson(res.text) as { datas?: unknown } | null;
      const rows = body?.datas;
      if (!Array.isArray(rows)) throw new SourceError("format", "네이버 지수 응답에 datas 배열이 없습니다");

      for (const id of ids) {
        const { code, keyField } = SYMBOLS[id];
        const row = (rows as Row[]).find((r) => r?.[keyField] === code);
        if (!row) throw new SourceError("format", `네이버 지수 응답에 ${code} 항목이 없습니다`);
        quotes.push(toQuote(id, row));
      }
    }
    return quotes;
  },
};
