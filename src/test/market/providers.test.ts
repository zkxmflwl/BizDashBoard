import { describe, expect, it } from "vitest";
import { createHttpClient, SourceError } from "../../../supabase/functions/_shared/market/http.ts";
import { eximFxProvider } from "../../../supabase/functions/_shared/market/providers/fx.exim.ts";
import {
  findLastPolicyChange,
  naverFxProvider,
  naverKrBondProvider,
  naverPolicyRateProvider,
  naverUsBondProvider,
} from "../../../supabase/functions/_shared/market/providers/marketIndex.naver.ts";
import { interleave, parseRss } from "../../../supabase/functions/_shared/market/providers/news.rss.ts";
import { ecosRatesProvider, findLastChange } from "../../../supabase/functions/_shared/market/providers/rates.ecos.ts";
import { fredRatesProvider } from "../../../supabase/functions/_shared/market/providers/rates.fred.ts";
import { naverStockIndexProvider } from "../../../supabase/functions/_shared/market/providers/stockIndex.naver.ts";
import type { HttpResponse, ProviderContext } from "../../../supabase/functions/_shared/market/types.ts";

/** URL을 받아 응답을 돌려주는 가짜 HTTP. 호출한 URL을 기록한다 */
function fakeCtx(now: Date, respond: (url: string) => HttpResponse | string) {
  const urls: string[] = [];
  const logged: string[] = [];
  const ctx: ProviderContext = {
    now,
    log: () => {},
    http: {
      calls: 0,
      async get(url, opts) {
        urls.push(url);
        logged.push(opts.logUrl ?? url);
        const r = respond(url);
        return typeof r === "string" ? { status: 200, text: r } : r;
      },
    },
  };
  return { ctx, urls, logged };
}

const NOW = new Date("2026-11-18T12:00:00+09:00");

/** 일부 피드 맨 앞에 붙어 있는 BOM */
const BOM = String.fromCharCode(0xfeff);

describe("원천 호출 HTTP 클라이언트", () => {
  it("요청이 실패해도 예외 메시지 원문(키가 들어간 URL)을 로그와 오류에 남기지 않는다", async () => {
    const lines: string[] = [];
    const failingFetch = (async () => {
      throw new TypeError("error sending request for url (https://api.example/?authkey=SECRET-KEY-1234)");
    }) as unknown as typeof fetch;
    const http = createHttpClient((line) => lines.push(line), failingFetch);

    await expect(
      http.get("https://api.example/?authkey=SECRET-KEY-1234", {
        source: "test",
        logUrl: "https://api.example/?authkey=***",
      }),
    ).rejects.toMatchObject({ kind: "transient", message: "요청 실패(네트워크 오류)" });

    expect(http.calls).toBe(1);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("SOURCE test GET https://api.example/?authkey=*** -> FAIL");
    expect(lines[0]).not.toContain("SECRET-KEY-1234");
  });
});

describe("네이버 지수 provider", () => {
  // 2026-11-18에 실제로 받은 응답에서 사용하는 필드만 남긴 것이다.
  const domestic = JSON.stringify({
    pollingInterval: 70000,
    datas: [
      {
        itemCode: "KOSPI",
        closePrice: "5,067.44",
        compareToPreviousClosePrice: "98.96",
        compareToPreviousPrice: { code: "2", text: "상승", name: "RISING" },
        fluctuationsRatio: "1.99",
        marketStatus: "CLOSE",
        localTradedAt: "2026-11-18T20:15:00+09:00",
        closePriceRaw: "5067.44",
        compareToPreviousClosePriceRaw: "98.96",
        fluctuationsRatioRaw: "1.99",
      },
      {
        itemCode: "KOSDAQ",
        closePrice: "662.81",
        compareToPreviousClosePrice: "12.75",
        compareToPreviousPrice: { code: "2", text: "상승", name: "RISING" },
        fluctuationsRatio: "1.96",
        marketStatus: "CLOSE",
        localTradedAt: "2026-11-18T20:15:00+09:00",
        closePriceRaw: "662.81",
        compareToPreviousClosePriceRaw: "12.75",
        fluctuationsRatioRaw: "1.96",
      },
    ],
  });
  const world = JSON.stringify({
    datas: [
      {
        reutersCode: ".IXIC",
        closePrice: "24,328.38",
        compareToPreviousClosePrice: "-181.38",
        compareToPreviousPrice: { code: "5", text: "하락", name: "FALLING" },
        fluctuationsRatio: "-0.74",
        marketStatus: "CLOSE",
        localTradedAt: "2026-11-17T17:15:59-05:00",
        closePriceRaw: "24328.38",
        compareToPreviousClosePriceRaw: "-181.38",
        fluctuationsRatioRaw: "-0.74",
      },
    ],
  });

  it("코스피와 코스닥을 한 번의 호출로 읽는다", async () => {
    const { ctx, urls } = fakeCtx(NOW, () => domestic);
    const quotes = await naverStockIndexProvider.fetchQuotes(["kospi", "kosdaq"], ctx);

    expect(urls).toEqual(["https://polling.finance.naver.com/api/realtime/domestic/index/KOSPI,KOSDAQ"]);
    expect(quotes[0]).toEqual({
      id: "kospi",
      value: 5067.44,
      change: 98.96,
      changePct: 1.99,
      asOf: "2026-11-18T11:15:00.000Z",
      marketOpen: false,
    });
    expect(quotes[1].value).toBe(662.81);
  });

  it("나스닥은 하락을 음수로 읽는다", async () => {
    const { ctx, urls } = fakeCtx(NOW, () => world);
    const [q] = await naverStockIndexProvider.fetchQuotes(["nasdaq"], ctx);
    expect(urls).toEqual(["https://polling.finance.naver.com/api/realtime/worldstock/index/.IXIC"]);
    expect(q).toMatchObject({ value: 24328.38, change: -181.38, changePct: -0.74, marketOpen: false });
  });

  it("필드가 없으면 추측하지 않고 형식 오류를 낸다", async () => {
    const broken = JSON.stringify({ datas: [{ itemCode: "KOSPI", price: "5067.44" }] });
    const { ctx } = fakeCtx(NOW, () => broken);
    await expect(naverStockIndexProvider.fetchQuotes(["kospi"], ctx)).rejects.toMatchObject({ kind: "format" });
  });

  it("403 응답은 차단으로 분류한다", async () => {
    const { ctx } = fakeCtx(NOW, () => ({ status: 403, text: "Forbidden" }));
    await expect(naverStockIndexProvider.fetchQuotes(["kospi"], ctx)).rejects.toMatchObject({ kind: "blocked" });
  });
});

describe("네이버 시장지표 provider (환율·금리, 키 불필요)", () => {
  // 2026-11-18에 실제로 받은 응답에서 사용하는 필드만 남긴 것이다.
  const fx = (code: string, price: string, diff: string, ratio: string) => ({
    reutersCode: code,
    closePrice: price,
    fluctuations: diff,
    fluctuationsRatio: ratio,
    fluctuationsType: { code: "5", text: "하락", name: "FALLING" },
    marketStatus: "OPEN",
    localTradedAt: "2026-11-18T22:08:43+09:00",
  });
  const fxList = JSON.stringify([
    fx("FX_USDKRW", "1,332.80", "-2.70", "-0.20"),
    fx("FX_EURKRW", "1,461.82", "-6.96", "-0.47"),
    fx("FX_JPYKRW", "836.00", "-1.75", "-0.21"),
    fx("FX_CNYKRW", "199.89", "-0.44", "-0.22"),
  ]);
  const bond = JSON.stringify({
    reutersCode: "KR3YT=RR",
    closePrice: "3.7460",
    fluctuations: "0.0190",
    fluctuationsRatio: "0.51",
    fluctuationsType: { code: "2", text: "상승", name: "RISING" },
    localTradedAt: "2026-11-18T16:19:24+09:00",
  });
  const release = (releaseDate: string, actualValue: number, changeValue: number) => ({
    releaseDate,
    actualValue,
    changeValue,
    previousValue: actualValue - changeValue,
    isRelease: true,
  });
  const policy = (closePrice: string, calendars: unknown[]) =>
    JSON.stringify({ closePrice, fluctuations: "0.00", fluctuationsRatio: "-", fluctuationsType: { name: "UNCHANGED" }, calendars });
  const korea = policy("3.00", [
    release("20261022", 3, 0),
    release("20260827", 3, 0.25),
    release("20260716", 2.75, 0.25),
    release("20260528", 2.5, 0),
  ]);
  const usa = policy("4.00", [release("20261029", 4, 0), release("20260917", 4, 0.25), release("20260730", 3.75, 0)]);

  it("환율 3종을 한 번의 호출로 읽는다", async () => {
    const { ctx, urls } = fakeCtx(NOW, () => fxList);
    const results = await naverFxProvider.fetch(ctx, "", ["usdkrw", "jpykrw", "cnykrw"]);

    expect(urls).toEqual(["https://api.stock.naver.com/marketindex/exchange/majors"]);
    expect(results[0]).toEqual({
      id: "usdkrw",
      value: 1332.8,
      change: -2.7,
      changePct: -0.2,
      changeKind: "prev",
      changedOn: null,
      asOf: "2026-11-18T13:08:43.000Z",
      asOfPrecision: "minute",
    });
    expect(results[1]).toMatchObject({ id: "jpykrw", value: 836, change: -1.75, changePct: -0.21 });
    expect(results[2]).toMatchObject({ id: "cnykrw", value: 199.89, change: -0.44, changePct: -0.22 });
  });

  it("국채 금리는 전일 종가 대비 변동을 읽는다", async () => {
    const { ctx, urls } = fakeCtx(NOW, () => bond);
    const [ktb] = await naverKrBondProvider.fetch(ctx, "", ["ktb3y"]);
    expect(urls).toEqual(["https://api.stock.naver.com/marketindex/bond/KR3YT=RR"]);
    expect(ktb).toMatchObject({ id: "ktb3y", value: 3.746, change: 0.019, changePct: null, asOf: "2026-11-18T07:19:24.000Z" });

    const us = fakeCtx(NOW, () => bond);
    await naverUsBondProvider.fetch(us.ctx, "", ["ust10y"]);
    expect(us.urls).toEqual(["https://api.stock.naver.com/marketindex/bond/US10YT=RR"]);
  });

  it("기준금리는 발표 이력에서 최근 변경일과 변경폭을 찾는다", async () => {
    const { ctx, urls } = fakeCtx(NOW, (url) => (url.endsWith("/KOR") ? korea : usa));
    const results = await naverPolicyRateProvider.fetch(ctx, "", ["krBaseRate", "usPolicyRate"]);

    expect(urls).toEqual([
      "https://api.stock.naver.com/marketindex/standardInterest/KOR",
      "https://api.stock.naver.com/marketindex/standardInterest/USA",
    ]);
    expect(results[0]).toEqual({
      id: "krBaseRate",
      value: 3,
      change: 0.25,
      changePct: null,
      changeKind: "policy",
      changedOn: "2026-08-27",
      asOf: "2026-11-18",
      asOfPrecision: "day",
    });
    expect(results[1]).toMatchObject({ id: "usPolicyRate", value: 4, change: 0.25, changedOn: "2026-09-17" });
  });

  it("이력 안에 변경이 없으면 변경일을 비워 둔다", () => {
    expect(findLastPolicyChange([release("20261022", 3, 0), release("20260827", 3, 0)])).toBeNull();
    expect(findLastPolicyChange(null)).toBeNull();
  });

  it("필드가 없거나 요청이 거부되면 값을 추측하지 않는다", async () => {
    const missing = fakeCtx(NOW, () => JSON.stringify([{ reutersCode: "FX_USDKRW", price: "1,332.80" }]));
    await expect(naverFxProvider.fetch(missing.ctx, "", ["usdkrw"])).rejects.toMatchObject({ kind: "format" });

    const denied = fakeCtx(NOW, () => ({ status: 403, text: "" }));
    await expect(naverPolicyRateProvider.fetch(denied.ctx, "", ["krBaseRate"])).rejects.toMatchObject({ kind: "blocked" });
  });
});

describe("RSS 파싱", () => {
  it("제목과 링크만 꺼내고 최신순 5건으로 자른다", () => {
    const item = (n: number, date: string) =>
      `<item><title><![CDATA[기사 ${n} &amp; "따옴표"]]></title><link>https://news.example/a?id=${n}&amp;utm=rss</link>` +
      `<description><![CDATA[<img src="x.jpg"/>본문 요약]]></description><pubDate>${date}</pubDate></item>`;
    const xml =
      `${BOM}<?xml version="1.0"?><rss><channel><title>경제</title>` +
      item(1, "Wed, 18 Nov 2026 09:00:00 +0900") +
      item(2, "Wed, 18 Nov 2026 11:00:00 +0900") +
      item(3, "Wed, 18 Nov 2026 10:00:00 +0900") +
      [4, 5, 6, 7].map((n) => item(n, `Tue, 17 Nov 2026 0${n}:00:00 +0900`)).join("") +
      `</channel></rss>`;

    const items = parseRss(xml, "테스트일보", NOW);
    expect(items).toHaveLength(5);
    expect(items.map((i) => i.title)[0]).toBe('기사 2 & "따옴표"');
    expect(items.map((i) => i.link)[0]).toBe("https://news.example/a?id=2&utm=rss");
    expect(items.map((i) => i.title.slice(0, 4))).toEqual(["기사 2", "기사 3", "기사 1", "기사 7", "기사 6"]);
    expect(Object.keys(items[0]).sort()).toEqual(["link", "press", "title"]);
  });

  it("dc:date를 발행일로 읽고, 링크 안의 공백을 인코딩한다", () => {
    const xml =
      `<rss xmlns:dc="http://purl.org/dc/elements/1.1/"><channel>` +
      `<item><title>첫째</title><link>https://news.example/K-TECH Global/1</link><dc:date>2026-11-18T08:00:00+09:00</dc:date></item>` +
      `<item><title>둘째</title><link>https://news.example/2</link><dc:date>2026-11-18T09:00:00+09:00</dc:date></item>` +
      `</channel></rss>`;
    const items = parseRss(xml, "테스트일보", NOW);
    expect(items.map((i) => i.title)).toEqual(["둘째", "첫째"]);
    expect(items[1].link).toBe("https://news.example/K-TECH%20Global/1");
  });

  it("HTML 태그는 지우고 제목에 쓰인 꺾쇠 문구는 남긴다", () => {
    const xml = `<rss><channel><item><title><![CDATA[<b>속보</b> <표> 주요 지수 &#99999999;]]></title><link>https://n.example/1</link></item></channel></rss>`;
    expect(parseRss(xml, "테스트일보", NOW)[0].title).toBe("속보 <표> 주요 지수 &#99999999;");
  });

  it("발행일이 없으면 피드에 실린 순서를 따른다", () => {
    const xml = `<rss><channel><item><title>A</title><link>https://n.example/1</link></item><item><title>B</title><link>https://n.example/2</link></item></channel></rss>`;
    expect(parseRss(xml, "테스트일보", NOW).map((i) => i.title)).toEqual(["A", "B"]);
  });

  it("최신 기사가 오래된 피드와 항목이 없는 응답은 제외한다", () => {
    const stale = `<rss><channel><item><title>옛 기사</title><link>https://n.example/1</link><pubDate>Mon, 02 Nov 2026 09:00:00 +0900</pubDate></item></channel></rss>`;
    expect(() => parseRss(stale, "테스트일보", NOW)).toThrow(SourceError);
    expect(() => parseRss("<html><body>403 Forbidden</body></html>", "테스트일보", NOW)).toThrow(SourceError);
  });

  it("언론사를 번갈아 배열한다", () => {
    const list = (press: string, n: number) =>
      Array.from({ length: n }, (_, i) => ({ press, title: `${press}${i + 1}`, link: `https://n.example/${press}/${i}` }));
    const mixed = interleave([list("A", 2), list("B", 1), list("C", 2)]);
    expect(mixed.map((n) => n.title)).toEqual(["A1", "B1", "C1", "A2", "C2"]);
  });
});

describe("수출입은행 환율 provider", () => {
  const day = (usd: string, jpy: string, cnh: string) =>
    JSON.stringify([
      { result: 1, cur_unit: "CNH", deal_bas_r: cnh },
      { result: 1, cur_unit: "JPY(100)", deal_bas_r: jpy },
      { result: 1, cur_unit: "USD", deal_bas_r: usd },
    ]);

  it("고시가 있는 최근 이틀을 찾아 직전 관측치와 비교한다", async () => {
    // 월요일 오전: 당일과 주말은 비어 있고 금요일, 목요일에 고시가 있다.
    const monday = new Date("2026-11-23T09:30:00+09:00");
    const { ctx, urls, logged } = fakeCtx(monday, (url) => {
      if (url.includes("searchdate=20261120")) return day("1,452.5", "951.05", "203.10");
      if (url.includes("searchdate=20261119")) return day("1,450.0", "953.00", "203.10");
      return url.includes("searchdate=20261121") ? "[]" : "null";
    });

    const results = await eximFxProvider.fetch(ctx, "SECRET-KEY", eximFxProvider.itemIds);
    expect(urls.map((u) => u.match(/searchdate=(\d+)/)![1])).toEqual(["20261123", "20261122", "20261121", "20261120", "20261119"]);
    expect(urls[0]).toContain("https://oapi.koreaexim.go.kr/site/program/financial/exchangeJSON?authkey=SECRET-KEY");
    expect(logged.every((u) => !u.includes("SECRET-KEY"))).toBe(true); // 로그에는 키를 남기지 않는다

    const usd = results.find((r) => r.id === "usdkrw")!;
    expect(usd).toMatchObject({ value: 1452.5, change: 2.5, changePct: 0.17, asOf: "2026-11-20", changeKind: "prev" });
    expect(results.find((r) => r.id === "jpykrw")).toMatchObject({ value: 951.05, change: -1.95, changePct: -0.2 });
    expect(results.find((r) => r.id === "cnykrw")).toMatchObject({ value: 203.1, change: 0, changePct: 0 });
  });

  it("인증키 오류(result 3)를 구분한다", async () => {
    const { ctx } = fakeCtx(NOW, () => JSON.stringify([{ result: 3 }]));
    await expect(eximFxProvider.fetch(ctx, "bad", eximFxProvider.itemIds)).rejects.toMatchObject({ kind: "auth" });
  });
});

describe("ECOS 금리 provider", () => {
  const row = (time: string, value: string) => ({ TIME: time, DATA_VALUE: value });
  const body = (total: number, rows: unknown[]) => JSON.stringify({ StatisticSearch: { list_total_count: total, row: rows } });

  it("가장 최근에 값이 바뀐 날짜와 변경폭을 찾는다", () => {
    const points = [
      { date: "2026-05-27", value: 2.75 },
      { date: "2026-05-28", value: 3 },
      { date: "2026-05-29", value: 3 },
    ];
    expect(findLastChange(points)).toEqual({ changedOn: "2026-05-28", change: 0.25 });
    expect(findLastChange(points.slice(1))).toBeNull();
  });

  it("기준금리는 최근 변경일과 변경폭을, 국고채 3년은 직전 관측치 대비를 돌려준다", async () => {
    const { ctx, urls, logged } = fakeCtx(NOW, (url) => {
      if (url.includes("/722Y001/")) {
        if (url.includes("/json/kr/1/1/")) return body(3, [row("20161121", "1.25")]);
        return body(3, [row("20260527", "2.75"), row("20260528", "3"), row("20261116", "3")]);
      }
      return body(3, [row("20261116", "3.639"), row("20261117", "3.633"), row("20261118", "3.669")]);
    });

    const results = await ecosRatesProvider.fetch(ctx, "ECOSKEY", ecosRatesProvider.itemIds);
    expect(urls[1]).toContain("https://ecos.bok.or.kr/api/StatisticSearch/ECOSKEY/json/kr/1/3/722Y001/D/");
    expect(urls[1]).toMatch(/\/20261118\/0101000$/);
    expect(urls[2]).toMatch(/\/817Y002\/D\/\d{8}\/20261118\/010200000$/);
    expect(logged.every((u) => !u.includes("ECOSKEY"))).toBe(true);

    expect(results.find((r) => r.id === "krBaseRate")).toMatchObject({
      value: 3,
      change: 0.25,
      changedOn: "2026-05-28",
      changeKind: "policy",
      asOf: "2026-11-16",
    });
    expect(results.find((r) => r.id === "ktb3y")).toMatchObject({ value: 3.669, change: 0.036, asOf: "2026-11-18" });
  });

  it("유효하지 않은 키(INFO-100)를 인증 오류로 분류한다", async () => {
    const { ctx } = fakeCtx(NOW, () => JSON.stringify({ RESULT: { CODE: "INFO-100", MESSAGE: "인증키가 유효하지 않습니다." } }));
    await expect(ecosRatesProvider.fetch(ctx, "bad", ecosRatesProvider.itemIds)).rejects.toMatchObject({ kind: "auth" });
  });
});

describe("FRED 금리 provider", () => {
  const obs = (rows: [string, string][]) => JSON.stringify({ observations: rows.map(([date, value]) => ({ date, value })) });

  it("기준금리 변경 시점을 찾고, 숫자가 아닌 관측치는 건너뛴다", async () => {
    const { ctx, urls, logged } = fakeCtx(NOW, (url) =>
      url.includes("series_id=DFEDTARU")
        ? obs([["2026-11-17", "4.00"], ["2026-11-16", "4.00"], ["2026-10-29", "4.00"], ["2026-10-28", "4.25"]])
        : obs([["2026-11-17", "4.12"], ["2026-11-16", "."], ["2026-11-13", "4.15"]]),
    );

    const results = await fredRatesProvider.fetch(ctx, "fredkey", fredRatesProvider.itemIds);
    expect(urls[0]).toContain("https://api.stlouisfed.org/fred/series/observations?series_id=DFEDTARU&file_type=json&sort_order=desc");
    expect(logged.every((u) => !u.includes("fredkey"))).toBe(true);

    expect(results.find((r) => r.id === "usPolicyRate")).toMatchObject({
      value: 4,
      change: -0.25,
      changedOn: "2026-10-29",
      changeKind: "policy",
    });
    expect(results.find((r) => r.id === "ust10y")).toMatchObject({ value: 4.12, change: -0.03, asOf: "2026-11-17" });
  });

  it("등록되지 않은 키(400)를 인증 오류로 분류한다", async () => {
    const { ctx } = fakeCtx(NOW, () => ({
      status: 400,
      text: JSON.stringify({ error_code: 400, error_message: "Bad Request.  The value for variable api_key is not registered." }),
    }));
    await expect(fredRatesProvider.fetch(ctx, "bad", fredRatesProvider.itemIds)).rejects.toMatchObject({ kind: "auth" });
  });
});
