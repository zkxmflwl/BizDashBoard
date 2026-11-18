import { describe, expect, it } from "vitest";
import { runCollector } from "../../../supabase/functions/_shared/market/collector.ts";
import { NEWS_FEEDS, STOCK_MARKETS } from "../../../supabase/functions/_shared/market/config.ts";
import { SourceError } from "../../../supabase/functions/_shared/market/http.ts";
import { isSessionOpen } from "../../../supabase/functions/_shared/market/time.ts";
import type {
  IndicatorProvider,
  IndexQuote,
  MarketSnapshot,
  NewsProvider,
  Providers,
  StockIndexProvider,
} from "../../../supabase/functions/_shared/market/types.ts";

// 2026-11-18은 수요일이다. KST = UTC+9.
const kst = (ymd: string, hms: string) => new Date(`${ymd}T${hms}+09:00`);

interface Fakes {
  providers: Providers;
  stockCalls: string[][];
  dailyCalls: number;
  newsCalls: string[];
  stockError: Error | null;
  dailyError: Error | null;
  failingPress: string | null;
  price: number;
}

function makeFakes(): Fakes {
  const fakes = {
    stockCalls: [] as string[][],
    dailyCalls: 0,
    newsCalls: [] as string[],
    stockError: null as Error | null,
    dailyError: null as Error | null,
    failingPress: null as string | null,
    price: 5000,
  } as Fakes;

  const stockIndex: StockIndexProvider = {
    id: "fake-index",
    async fetchQuotes(itemIds, ctx): Promise<IndexQuote[]> {
      fakes.stockCalls.push(itemIds);
      if (fakes.stockError) throw fakes.stockError;
      fakes.price += 1;
      return itemIds.map((id) => ({
        id,
        value: fakes.price,
        change: 10,
        changePct: 0.2,
        asOf: ctx.now.toISOString(),
        marketOpen: true,
      }));
    },
  };

  const daily: IndicatorProvider = {
    id: "fake-daily",
    envKey: "EXIM_API_KEY",
    itemIds: ["usdkrw", "jpykrw", "cnykrw"],
    cadence: { every: "day", atKst: "11:30" },
    async fetch() {
      fakes.dailyCalls += 1;
      if (fakes.dailyError) throw fakes.dailyError;
      return ["usdkrw", "jpykrw", "cnykrw"].map((id) => ({
        id,
        value: 1400 + fakes.dailyCalls,
        change: 1,
        changePct: 0.07,
        changeKind: "prev" as const,
        changedOn: null,
        asOf: "2026-11-18",
      }));
    },
  };

  const news: NewsProvider = {
    id: "fake-news",
    async fetchFeed(feed) {
      fakes.newsCalls.push(feed.press);
      if (feed.press === fakes.failingPress) throw new SourceError("blocked", "HTTP 403");
      return [1, 2].map((n) => ({
        press: feed.press,
        title: `${feed.press} 기사 ${n} (${fakes.newsCalls.length})`,
        link: `https://example.com/${encodeURIComponent(feed.press)}/${n}`,
      }));
    },
  };

  fakes.providers = { stockIndex, indicators: [daily], news };
  return fakes;
}

async function run(prev: MarketSnapshot | null, now: Date, fakes: Fakes, env: Record<string, string> = {}) {
  const lines: string[] = [];
  const result = await runCollector(prev, { now, env, log: (l) => lines.push(l), providers: fakes.providers });
  return { ...result, lines };
}

describe("거래시간 판정", () => {
  const kr = STOCK_MARKETS.find((m) => m.id === "kr")!.session;
  const us = STOCK_MARKETS.find((m) => m.id === "us")!.session;

  it("한국 시장은 평일 09:00~15:30 KST에만 열린다", () => {
    expect(isSessionOpen(kst("2026-11-18", "08:59:59"), kr)).toBe(false);
    expect(isSessionOpen(kst("2026-11-18", "09:00:00"), kr)).toBe(true);
    expect(isSessionOpen(kst("2026-11-18", "15:30:59"), kr)).toBe(true);
    expect(isSessionOpen(kst("2026-11-18", "15:31:00"), kr)).toBe(false);
    expect(isSessionOpen(kst("2026-11-21", "10:00:00"), kr)).toBe(false); // 토요일
  });

  it("미국 시장은 서머타임을 반영한다", () => {
    expect(isSessionOpen(new Date("2026-11-18T14:30:00Z"), us)).toBe(true); // 표준시 09:30
    expect(isSessionOpen(new Date("2026-11-18T13:30:00Z"), us)).toBe(false);
    expect(isSessionOpen(new Date("2026-07-15T13:30:00Z"), us)).toBe(true); // 서머타임 09:30
  });
});

describe("증시 수집", () => {
  it("장중에는 같은 분에 여러 번 실행해도 원천을 한 번만 호출한다", async () => {
    const fakes = makeFakes();
    let snap: MarketSnapshot | null = null;

    // 5분 동안 10초마다 실행(분당 6회)해도 한국 시장 호출은 분당 1회여야 한다.
    const start = kst("2026-11-18", "10:00:00").getTime();
    for (let s = 0; s < 5 * 60; s += 10) {
      snap = (await run(snap, new Date(start + s * 1000), fakes)).snapshot;
    }

    const krCalls = fakes.stockCalls.filter((ids) => ids.includes("kospi"));
    expect(krCalls).toHaveLength(5);
    expect(krCalls[0]).toEqual(["kospi", "kosdaq"]);
    expect(snap!.items.kospi.status).toBe("live");
    expect(snap!.items.kospi.value).toBeGreaterThan(5000);
  });

  it("거래시간 밖에서는 호출하지 않고 마지막 값에 장 마감을 표시한다", async () => {
    const fakes = makeFakes();
    let snap = (await run(null, kst("2026-11-18", "15:30:10"), fakes)).snapshot;
    const lastValue = snap.items.kospi.value;
    expect(snap.items.kospi.status).toBe("live");

    const before = fakes.stockCalls.filter((ids) => ids.includes("kospi")).length;
    for (const hms of ["15:31:05", "15:32:05", "20:00:05"]) {
      snap = (await run(snap, kst("2026-11-18", hms), fakes)).snapshot;
    }

    expect(fakes.stockCalls.filter((ids) => ids.includes("kospi"))).toHaveLength(before);
    expect(snap.items.kospi.status).toBe("closed");
    expect(snap.items.kospi.value).toBe(lastValue);
  });

  it("캐시가 비어 있으면 거래시간 밖이어도 시장별로 한 번만 조회한다", async () => {
    const fakes = makeFakes();
    let snap = (await run(null, kst("2026-11-18", "21:00:05"), fakes)).snapshot;
    snap = (await run(snap, kst("2026-11-18", "21:01:05"), fakes)).snapshot;
    snap = (await run(snap, kst("2026-11-18", "21:02:05"), fakes)).snapshot;

    expect(fakes.stockCalls).toEqual([["kospi", "kosdaq"], ["nasdaq"]]);
    expect(snap.items.kospi.status).toBe("closed");
  });

  it("일시적 실패에는 마지막 성공 값을 유지하고 오류만 표시한다", async () => {
    const fakes = makeFakes();
    let snap = (await run(null, kst("2026-11-18", "10:00:05"), fakes)).snapshot;
    const good = snap.items.kospi.value;

    fakes.stockError = new SourceError("transient", "시간 초과");
    snap = (await run(snap, kst("2026-11-18", "10:01:05"), fakes)).snapshot;
    expect(snap.items.kospi.value).toBe(good);
    expect(snap.items.kospi.status).toBe("live");
    expect(snap.items.kospi.error).toBe("시간 초과");

    fakes.stockError = null;
    snap = (await run(snap, kst("2026-11-18", "10:02:05"), fakes)).snapshot;
    expect(snap.items.kospi.error).toBeNull();
    expect(snap.items.kospi.value).toBeGreaterThan(good!);
  });

  it("차단되면 샘플로 전환하고 쉬는 시간 동안 다시 호출하지 않는다", async () => {
    const fakes = makeFakes();
    let snap = (await run(null, kst("2026-11-18", "10:00:05"), fakes)).snapshot;

    fakes.stockError = new SourceError("blocked", "원천이 요청을 거부했습니다(HTTP 403)");
    const blocked = await run(snap, kst("2026-11-18", "10:01:05"), fakes);
    snap = blocked.snapshot;
    expect(snap.items.kospi.status).toBe("sample");
    expect(snap.items.kospi.error).toContain("403");
    expect(blocked.lines.some((l) => l.startsWith("REPORT stocks:kr"))).toBe(true);

    const callsAfterBlock = fakes.stockCalls.length;
    for (const hms of ["10:02:05", "10:10:05", "10:30:05"]) {
      snap = (await run(snap, kst("2026-11-18", hms), fakes)).snapshot;
    }
    expect(fakes.stockCalls).toHaveLength(callsAfterBlock);

    fakes.stockError = null;
    snap = (await run(snap, kst("2026-11-18", "10:32:05"), fakes)).snapshot; // 30분 뒤 재개
    expect(snap.items.kospi.status).toBe("live");
  });
});

describe("환율·금리 수집(일 1회)", () => {
  it("키가 없으면 호출하지 않고 샘플로 동작한다", async () => {
    const fakes = makeFakes();
    const { snapshot } = await run(null, kst("2026-11-18", "12:00:00"), fakes);
    expect(fakes.dailyCalls).toBe(0);
    expect(snapshot.items.usdkrw.status).toBe("sample");
    expect(snapshot.items.krBaseRate.status).toBe("sample");
  });

  it("키가 있으면 하루 한 번만 호출한다", async () => {
    const fakes = makeFakes();
    const env = { EXIM_API_KEY: "test-key" };
    let snap = (await run(null, kst("2026-11-18", "09:00:05"), fakes, env)).snapshot; // 첫 실행
    expect(fakes.dailyCalls).toBe(1);
    expect(snap.items.usdkrw.status).toBe("daily");

    for (const hms of ["09:01:05", "10:00:05", "11:29:55"]) {
      snap = (await run(snap, kst("2026-11-18", hms), fakes, env)).snapshot;
    }
    expect(fakes.dailyCalls).toBe(1);

    snap = (await run(snap, kst("2026-11-18", "11:30:05"), fakes, env)).snapshot; // 정해진 시각
    snap = (await run(snap, kst("2026-11-18", "18:00:05"), fakes, env)).snapshot;
    expect(fakes.dailyCalls).toBe(2);

    snap = (await run(snap, kst("2026-11-19", "11:30:05"), fakes, env)).snapshot; // 다음 날
    expect(fakes.dailyCalls).toBe(3);
  });

  /** API 키가 필요 없는 소스를 흉내 낸다 */
  function makeKeyless() {
    const calls: string[][] = [];
    const state = { error: null as Error | null };
    const provider: IndicatorProvider = {
      id: "fake-keyless",
      envKey: null,
      itemIds: ["usdkrw", "jpykrw", "cnykrw", "ktb3y"],
      cadence: { every: "hour" },
      async fetch(_ctx, _apiKey, itemIds) {
        calls.push(itemIds);
        if (state.error) throw state.error;
        return itemIds.map((id) => ({
          id,
          value: 1332.8,
          change: -2.7,
          changePct: -0.2,
          changeKind: "prev" as const,
          changedOn: null,
          asOf: "2026-11-18T13:08:43.000Z",
          asOfPrecision: "minute" as const,
        }));
      },
    };
    return { provider, calls, state };
  }

  it("키가 없는 항목은 키가 필요 없는 소스의 실제 값으로 채우고, 키가 있으면 공식 API가 우선한다", async () => {
    const fakes = makeFakes();
    const keyless = makeKeyless();
    fakes.providers.indicators = [fakes.providers.indicators[0], keyless.provider];

    // 키 없음: 공식 API는 부르지 않고 키가 필요 없는 소스가 항목을 맡는다.
    let snap = (await run(null, kst("2026-11-18", "12:00:05"), fakes)).snapshot;
    expect(fakes.dailyCalls).toBe(0);
    expect(keyless.calls).toEqual([["usdkrw", "jpykrw", "cnykrw", "ktb3y"]]);
    expect(snap.items.usdkrw).toMatchObject({
      status: "hourly",
      value: 1332.8,
      source: "fake-keyless",
      asOf: "2026-11-18T13:08:43.000Z",
      asOfPrecision: "minute",
    });
    expect(snap.items.krBaseRate.status).toBe("sample"); // 어떤 소스도 맡지 않은 항목은 샘플

    // 키 추가: 공식 API가 환율을 바로 맡는다. 남은 항목은 이번 시간에 이미 수집했으므로 다시 부르지 않는다.
    snap = (await run(snap, kst("2026-11-18", "12:01:05"), fakes, { EXIM_API_KEY: "test-key" })).snapshot;
    expect(fakes.dailyCalls).toBe(1);
    expect(snap.items.usdkrw.source).toBe("fake-daily");
    expect(snap.items.ktb3y.source).toBe("fake-keyless");
    expect(keyless.calls).toHaveLength(1);

    // 다음 정각에는 남은 항목만 요청한다. 공식 API(일 1회)는 다시 부르지 않는다.
    snap = (await run(snap, kst("2026-11-18", "13:00:05"), fakes, { EXIM_API_KEY: "test-key" })).snapshot;
    expect(keyless.calls[1]).toEqual(["ktb3y"]);
    expect(fakes.dailyCalls).toBe(1);
    expect(snap.items.usdkrw.status).toBe("daily");
    expect(snap.items.ktb3y.status).toBe("hourly");
  });

  it("키가 필요 없는 소스가 차단되면 우회하지 않고 샘플로 전환한다", async () => {
    const fakes = makeFakes();
    const keyless = makeKeyless();
    fakes.providers.indicators = [keyless.provider];

    let snap = (await run(null, kst("2026-11-18", "12:00:05"), fakes)).snapshot;
    expect(snap.items.usdkrw.status).toBe("hourly");

    keyless.state.error = new SourceError("blocked", "원천이 요청을 거부했습니다(HTTP 403)");
    const blocked = await run(snap, kst("2026-11-18", "13:00:05"), fakes);
    snap = blocked.snapshot;
    expect(snap.items.usdkrw.status).toBe("sample");
    expect(snap.items.usdkrw.error).toContain("403");
    expect(blocked.lines.some((l) => l.startsWith("REPORT fake-keyless"))).toBe(true);

    // 일시적 실패라면 마지막 값을 유지한다.
    keyless.state.error = null;
    snap = (await run(snap, kst("2026-11-18", "13:30:05"), fakes)).snapshot; // 같은 시간 안에서는 다시 부르지 않는다
    expect(keyless.calls).toHaveLength(2);
    snap = (await run(snap, kst("2026-11-18", "14:00:05"), fakes)).snapshot; // 다음 정각에 다시 시도해 성공
    expect(snap.items.usdkrw.status).toBe("hourly");
    keyless.state.error = new SourceError("transient", "요청 실패(시간 초과)");
    snap = (await run(snap, kst("2026-11-18", "15:00:05"), fakes)).snapshot;
    expect(snap.items.usdkrw).toMatchObject({ status: "hourly", value: 1332.8, error: "요청 실패(시간 초과)" });
  });

  it("매시간 주기의 소스는 한 시간에 한 번만 호출한다", async () => {
    const fakes = makeFakes();
    const keyless = makeKeyless();
    fakes.providers.indicators = [keyless.provider];

    // 22:14에 시작해 1분마다 실행하며 다음 날 01:05까지 돌린다(자정 포함).
    let snap: MarketSnapshot | null = null;
    const start = kst("2026-11-18", "22:14:01").getTime();
    const attemptedAt: string[] = [];
    for (let minute = 0; minute <= 171; minute += 1) {
      const now = new Date(start + minute * 60_000);
      const result = await run(snap, now, fakes);
      snap = result.snapshot;
      if (result.attempted.includes("fake-keyless")) attemptedAt.push(now.toISOString().slice(11, 16));
    }

    // 시작 직후 1회, 그 뒤로는 매시 정각(KST 23:00, 00:00, 01:00 = UTC 14:00, 15:00, 16:00)에만 호출
    expect(attemptedAt).toEqual(["13:14", "14:00", "15:00", "16:00"]);
    expect(keyless.calls).toHaveLength(4);
  });

  it("수집기가 꺼져 있어 놓친 회차는 다시 켜졌을 때 한 번 보충한다", async () => {
    const fakes = makeFakes();
    const env = { EXIM_API_KEY: "test-key" };
    let snap = (await run(null, kst("2026-11-18", "09:00:05"), fakes, env)).snapshot; // 첫 실행 뒤 종료
    expect(fakes.dailyCalls).toBe(1);

    snap = (await run(snap, kst("2026-11-19", "09:00:05"), fakes, env)).snapshot; // 전날 11:30 회차를 놓친 상태
    expect(fakes.dailyCalls).toBe(2);

    snap = (await run(snap, kst("2026-11-19", "09:01:05"), fakes, env)).snapshot;
    expect(fakes.dailyCalls).toBe(2);
  });

  it("오류 문구와 로그에 API 키 값을 남기지 않는다", async () => {
    const fakes = makeFakes();
    const env = { EXIM_API_KEY: "SECRET-KEY-1234" };
    fakes.dailyError = new Error("error sending request for url (https://api.example/x?authkey=SECRET-KEY-1234&data=AP01)");

    const { snapshot, lines } = await run(null, kst("2026-11-18", "12:00:05"), fakes, env);
    expect(snapshot.items.usdkrw.error).toContain("authkey=***");
    expect(JSON.stringify(snapshot)).not.toContain("SECRET-KEY-1234");
    expect(lines.join("\n")).not.toContain("SECRET-KEY-1234");
  });

  it("실패하면 마지막 값을 유지하고 1시간 뒤에 다시 시도한다", async () => {
    const fakes = makeFakes();
    const env = { EXIM_API_KEY: "test-key" };
    let snap = (await run(null, kst("2026-11-18", "09:00:05"), fakes, env)).snapshot;
    const good = snap.items.usdkrw.value;

    fakes.dailyError = new SourceError("transient", "원천 서버 오류(HTTP 500)");
    snap = (await run(snap, kst("2026-11-18", "11:30:05"), fakes, env)).snapshot;
    expect(snap.items.usdkrw.value).toBe(good);
    expect(snap.items.usdkrw.status).toBe("daily");
    expect(snap.items.usdkrw.error).toContain("500");

    snap = (await run(snap, kst("2026-11-18", "12:00:05"), fakes, env)).snapshot;
    expect(fakes.dailyCalls).toBe(2); // 아직 1시간이 지나지 않음

    fakes.dailyError = null;
    snap = (await run(snap, kst("2026-11-18", "12:30:10"), fakes, env)).snapshot;
    expect(fakes.dailyCalls).toBe(3);
    expect(snap.items.usdkrw.error).toBeNull();
  });
});

describe("뉴스 수집(10분 주기)", () => {
  it("같은 10분 구간에서는 한 번만 수집하고 언론사를 번갈아 배열한다", async () => {
    const fakes = makeFakes();
    let snap = (await run(null, kst("2026-11-18", "21:00:05"), fakes)).snapshot;
    for (const hms of ["21:01:05", "21:05:05", "21:09:55"]) {
      snap = (await run(snap, kst("2026-11-18", hms), fakes)).snapshot;
    }
    expect(fakes.newsCalls).toHaveLength(NEWS_FEEDS.length);

    const presses = NEWS_FEEDS.map((f) => f.press);
    expect(snap.news.items.slice(0, presses.length).map((n) => n.press)).toEqual(presses);
    expect(snap.news.items).toHaveLength(presses.length * 2);

    snap = (await run(snap, kst("2026-11-18", "21:10:05"), fakes)).snapshot;
    expect(fakes.newsCalls).toHaveLength(NEWS_FEEDS.length * 2);
  });

  it("일부 피드가 실패하면 그 언론사의 이전 기사를 유지한다", async () => {
    const fakes = makeFakes();
    let snap = (await run(null, kst("2026-11-18", "21:00:05"), fakes)).snapshot;
    const target = NEWS_FEEDS[1].press;
    const before = snap.news.byPress[target];

    fakes.failingPress = target;
    snap = (await run(snap, kst("2026-11-18", "21:10:05"), fakes)).snapshot;
    expect(snap.news.byPress[target]).toEqual(before);
    expect(snap.news.failed).toEqual([{ press: target, error: "HTTP 403" }]);
    expect(snap.news.items.some((n) => n.press === target)).toBe(true);
  });
});
