// 수집기 본체. 호스트(로컬 Node 서버, Supabase Edge Function)가 1분마다 한 번 호출한다.
//
// 원칙
// - 원천 호출 여부는 접속자 수가 아니라 캐시에 기록된 마지막 시도 시각으로만 결정한다.
// - 증시는 거래시간 안에서 시장별로 분당 1회, 뉴스는 10분에 1회 호출한다.
// - 환율·금리는 공식 API 키가 있으면 공식 API를 하루 1회, 없으면 키가 필요 없는 소스의 실제 값을 1시간에 1회 읽는다.
// - 수집에 실패하면 마지막 성공 값을 유지하고 error만 채운다(화면에서 오류 배지).
// - 원천이 요청을 거부하거나 형식이 바뀌면 우회하지 않고 샘플 데이터로 전환한 뒤 호출을 쉰다.

import {
  BLOCK_COOLDOWN_MS,
  DAILY_RETRY_MS,
  NEWS_FEEDS,
  NEWS_POLL_MS,
  NEWS_SOURCE_ID,
  SEED_STOCKS_WHEN_EMPTY,
  STOCK_MARKETS,
  STOCK_POLL_MS,
} from "./config.ts";
import { createHttpClient, createScrubber, SourceError, toSourceError } from "./http.ts";
import { defaultProviders } from "./providers/index.ts";
import { interleave } from "./providers/news.rss.ts";
import { ALL_ITEM_IDS, sampleItem } from "./sample.ts";
import { isSessionOpen, kstDateAt, kstYmd, slotOf } from "./time.ts";
import type {
  Cadence,
  IndicatorProvider,
  Logger,
  MarketSnapshot,
  ProviderContext,
  Providers,
  SourceState,
  StockMarket,
} from "./types.ts";

export interface CollectorOptions {
  now: Date;
  /** API 키. 환경변수에서 읽어 호스트가 넘긴다 */
  env: Record<string, string | undefined>;
  log: Logger;
  fetchImpl?: typeof fetch;
  /** 테스트와 모의 실행에서 provider를 바꿔 끼울 때 쓴다 */
  providers?: Partial<Providers>;
  /** 모의 실행 전용. 거래시간 판정을 건너뛴다. 실제 원천을 호출하는 provider와 함께 쓰지 않는다 */
  forceStockSessionOpen?: boolean;
}

export interface CollectorResult {
  snapshot: MarketSnapshot;
  /** 이번 실행에서 발생한 원천 HTTP 호출 수 */
  sourceCalls: number;
  /** 이번 실행에서 수집을 시도한 소스 id */
  attempted: string[];
}

function emptyState(): SourceState {
  return { lastAttemptAt: null, lastSuccessAt: null, lastError: null, cooldownUntil: null };
}

/** 이전 캐시를 복사하고, 빠진 항목은 샘플로 채운다. 이전 캐시가 없거나 형식이 다르면 새로 만든다 */
function prepare(prev: MarketSnapshot | null): MarketSnapshot {
  const base: MarketSnapshot =
    prev && prev.schema === 1
      ? (JSON.parse(JSON.stringify(prev)) as MarketSnapshot)
      : {
          schema: 1,
          generatedAt: "",
          items: {},
          news: { items: [], byPress: {}, fetchedAt: null, failed: [] },
          sources: {},
        };
  for (const id of ALL_ITEM_IDS) {
    if (!base.items[id]) base.items[id] = sampleItem(id);
  }
  return base;
}

function stateOf(snap: MarketSnapshot, sourceId: string): SourceState {
  if (!snap.sources[sourceId]) snap.sources[sourceId] = emptyState();
  return snap.sources[sourceId];
}

async function collectStocks(
  snap: MarketSnapshot,
  market: StockMarket,
  providers: Providers,
  ctx: ProviderContext,
  opts: CollectorOptions,
  attempted: string[],
): Promise<void> {
  const { now, log } = opts;
  const st = stateOf(snap, market.sourceId);

  if (!market.enabled) {
    for (const id of market.itemIds) snap.items[id] = sampleItem(id);
    return;
  }

  const open = opts.forceStockSessionOpen === true || isSessionOpen(now, market.session);
  const closeIfLive = () => {
    for (const id of market.itemIds) {
      if (snap.items[id].status === "live") snap.items[id].status = "closed";
    }
  };

  const coolingDown = st.cooldownUntil !== null && Date.parse(st.cooldownUntil) > now.getTime();
  const sameSlot = slotOf(st.lastAttemptAt, STOCK_POLL_MS) === slotOf(now, STOCK_POLL_MS);
  const seed = SEED_STOCKS_WHEN_EMPTY && st.lastAttemptAt === null;
  if (coolingDown || sameSlot || !(open || seed)) {
    if (!open) closeIfLive(); // 거래시간 밖에서는 호출하지 않고 마지막 값에 장 마감 표시
    return;
  }

  st.lastAttemptAt = now.toISOString();
  attempted.push(market.sourceId);
  try {
    const quotes = await providers.stockIndex.fetchQuotes(market.itemIds, ctx);
    for (const id of market.itemIds) {
      const q = quotes.find((x) => x.id === id);
      if (!q) throw new SourceError("format", `${providers.stockIndex.id} 응답에 ${id} 값이 없습니다`);
      snap.items[id] = {
        id,
        group: "stocks",
        value: q.value,
        change: q.change,
        changePct: q.changePct,
        changeKind: "prev",
        changedOn: null,
        asOf: q.asOf,
        asOfPrecision: "minute",
        status: q.sample ? "sample" : open && q.marketOpen ? "live" : "closed",
        error: null,
        source: providers.stockIndex.id,
      };
    }
    st.lastSuccessAt = now.toISOString();
    st.lastError = null;
    st.cooldownUntil = null;
  } catch (e) {
    const err = toSourceError(e);
    st.lastError = err.message;
    if (err.kind === "blocked" || err.kind === "format") {
      st.cooldownUntil = new Date(now.getTime() + BLOCK_COOLDOWN_MS).toISOString();
      for (const id of market.itemIds) snap.items[id] = { ...sampleItem(id), error: err.message };
      log(`REPORT ${market.sourceId} 원천 차단 또는 형식 변경으로 샘플 데이터로 전환했습니다: ${err.message}`);
    } else {
      for (const id of market.itemIds) snap.items[id].error = err.message; // 마지막 성공 값 유지
      if (!open) closeIfLive();
      log(`WARN ${market.sourceId} 수집 실패, 마지막 값을 유지합니다: ${err.message}`);
    }
  }
}

/** 매시간 수집의 구간 길이. KST와 UTC는 정시 단위로 차이 나므로 구간 경계가 매시 정각과 일치한다 */
const HOUR_MS = 3_600_000;

function isIndicatorDue(now: Date, st: SourceState, cadence: Cadence): boolean {
  if (st.lastAttemptAt === null) return true; // 첫 실행

  // 매시간: 마지막 시도와 시(時)가 달라지면 수집한다. 실패했어도 다음 정각에 다시 시도한다.
  if (cadence.every === "hour") return slotOf(st.lastAttemptAt, HOUR_MS) !== slotOf(now, HOUR_MS);

  // 일 1회
  const last = Date.parse(st.lastAttemptAt);
  if (st.lastError !== null) return now.getTime() - last >= DAILY_RETRY_MS; // 실패 후 재시도
  // 가장 최근에 지난 수집 시각 이후로 시도한 적이 없으면 수집한다.
  // 수집기가 꺼져 있어 어제 회차를 놓쳤다면 다시 켜졌을 때 보충한다.
  const todayRun = kstDateAt(kstYmd(now), cadence.atKst).getTime();
  const latestRun = now.getTime() >= todayRun ? todayRun : todayRun - 86_400_000;
  return last < latestRun;
}

/** 증시에 속하지 않는 항목(환율, 금리)은 모두 여기서 수집한다 */
const STOCK_ITEM_IDS = new Set(STOCK_MARKETS.flatMap((m) => m.itemIds));

/**
 * 환율·금리 항목을 수집한다. 주기는 맡은 provider가 정한다(매시간 또는 일 1회).
 * 항목마다 등록 순서가 앞선 사용 가능한 provider 하나가 맡는다.
 * 공식 API는 키가 있을 때만 사용 가능하고, 키가 필요 없는 소스는 항상 사용 가능하다.
 * 어떤 provider도 맡지 않은 항목은 샘플로 둔다.
 */
async function collectIndicators(
  snap: MarketSnapshot,
  providers: Providers,
  ctx: ProviderContext,
  opts: CollectorOptions,
  attempted: string[],
): Promise<void> {
  const claimed = new Set<string>();

  for (const provider of providers.indicators) {
    const apiKey = provider.envKey === null ? "" : (opts.env[provider.envKey] ?? "").trim();
    const usable = provider.envKey === null || apiKey !== "";
    const itemIds = usable ? provider.itemIds.filter((id) => !claimed.has(id)) : [];
    if (itemIds.length === 0) {
      // 맡은 항목이 없으면 기록을 지운다. 나중에 다시 맡게 되면 바로 수집한다.
      delete snap.sources[provider.id];
      continue;
    }
    for (const id of itemIds) claimed.add(id);
    await collectIndicator(snap, provider, apiKey, itemIds, ctx, opts, attempted);
  }

  for (const id of ALL_ITEM_IDS) {
    if (!STOCK_ITEM_IDS.has(id) && !claimed.has(id)) snap.items[id] = sampleItem(id);
  }
}

async function collectIndicator(
  snap: MarketSnapshot,
  provider: IndicatorProvider,
  apiKey: string,
  itemIds: string[],
  ctx: ProviderContext,
  opts: CollectorOptions,
  attempted: string[],
): Promise<void> {
  const { now, log } = opts;
  const st = stateOf(snap, provider.id);
  if (!isIndicatorDue(now, st, provider.cadence)) return;

  st.lastAttemptAt = now.toISOString();
  attempted.push(provider.id);
  try {
    const results = await provider.fetch(ctx, apiKey, itemIds);
    for (const id of itemIds) {
      const r = results.find((x) => x.id === id);
      if (!r) throw new SourceError("format", `${provider.id} 응답에 ${id} 값이 없습니다`);
      snap.items[id] = {
        id,
        group: snap.items[id].group,
        value: r.value,
        change: r.change,
        changePct: r.changePct,
        changeKind: r.changeKind,
        changedOn: r.changedOn,
        asOf: r.asOf,
        asOfPrecision: r.asOfPrecision ?? "day",
        status: provider.cadence.every === "hour" ? "hourly" : "daily",
        error: null,
        source: provider.id,
      };
    }
    st.lastSuccessAt = now.toISOString();
    st.lastError = null;
  } catch (e) {
    const err = toSourceError(e);
    st.lastError = err.message;
    // 키가 필요 없는 비공식 소스가 요청을 거부하거나 형식이 바뀌면 우회하지 않고 샘플로 전환한다.
    // 그 밖의 실패는 마지막 성공 값을 유지한다.
    const toSample = provider.envKey === null && (err.kind === "blocked" || err.kind === "format");
    for (const id of itemIds) {
      if (toSample) snap.items[id] = { ...sampleItem(id), error: err.message };
      else snap.items[id].error = err.message;
    }
    log(
      toSample
        ? `REPORT ${provider.id} 원천 차단 또는 형식 변경으로 샘플 데이터로 전환했습니다: ${err.message}`
        : `WARN ${provider.id} 수집 실패, 마지막 값을 유지합니다: ${err.message}`,
    );
  }
}

async function collectNews(
  snap: MarketSnapshot,
  providers: Providers,
  ctx: ProviderContext,
  opts: CollectorOptions,
  attempted: string[],
): Promise<void> {
  const { now, log } = opts;
  const st = stateOf(snap, NEWS_SOURCE_ID);
  if (st.lastAttemptAt !== null && slotOf(st.lastAttemptAt, NEWS_POLL_MS) === slotOf(now, NEWS_POLL_MS)) return;

  st.lastAttemptAt = now.toISOString();
  attempted.push(NEWS_SOURCE_ID);

  const settled = await Promise.allSettled(NEWS_FEEDS.map((feed) => providers.news.fetchFeed(feed, ctx)));
  const failed: { press: string; error: string }[] = [];
  const byPress: Record<string, MarketSnapshot["news"]["byPress"][string]> = {};
  settled.forEach((result, i) => {
    const { press } = NEWS_FEEDS[i];
    if (result.status === "fulfilled") {
      byPress[press] = result.value;
    } else {
      const err = toSourceError(result.reason);
      failed.push({ press, error: err.message });
      if (snap.news.byPress[press]) byPress[press] = snap.news.byPress[press]; // 이전 성공분 유지
      log(`WARN ${NEWS_SOURCE_ID} ${press} 피드 수집 실패: ${err.message}`);
    }
  });

  snap.news.byPress = byPress;
  snap.news.items = interleave(NEWS_FEEDS.map((feed) => byPress[feed.press] ?? []));
  snap.news.failed = failed;
  st.lastError = failed.length > 0 ? failed.map((f) => `${f.press}: ${f.error}`).join(" / ") : null;
  if (failed.length < NEWS_FEEDS.length) {
    snap.news.fetchedAt = now.toISOString();
    st.lastSuccessAt = now.toISOString();
  }
}

/** 이전 캐시와 현재 시각을 받아 필요한 소스만 수집하고 새 캐시를 돌려준다 */
export async function runCollector(prev: MarketSnapshot | null, options: CollectorOptions): Promise<CollectorResult> {
  // API 키 값이 로그나 캐시 JSON에 남지 않도록 로그는 쓰기 직전에, 오류 문구는 저장 직전에 한 번 더 가린다.
  const scrub = createScrubber(options.env);
  const opts: CollectorOptions = { ...options, log: (line) => options.log(scrub(line)) };

  const http = createHttpClient(opts.log, opts.fetchImpl);
  const ctx: ProviderContext = { now: opts.now, http, log: opts.log };
  const providers: Providers = { ...defaultProviders, ...opts.providers };
  const snap = prepare(prev);
  const attempted: string[] = [];

  for (const market of STOCK_MARKETS) {
    await collectStocks(snap, market, providers, ctx, opts, attempted);
  }
  await collectIndicators(snap, providers, ctx, opts, attempted);
  await collectNews(snap, providers, ctx, opts, attempted);

  for (const item of Object.values(snap.items)) {
    if (item.error) item.error = scrub(item.error);
  }
  for (const state of Object.values(snap.sources)) {
    if (state.lastError) state.lastError = scrub(state.lastError);
  }
  for (const failure of snap.news.failed) failure.error = scrub(failure.error);

  snap.generatedAt = opts.now.toISOString();
  return { snapshot: snap, sourceCalls: http.calls, attempted };
}
