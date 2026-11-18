// 수집기가 기록하고 화면이 읽는 캐시 JSON의 계약.
// 이 폴더의 코드는 Deno(Supabase Edge Function)와 Node(로컬 수집기) 양쪽에서 실행되므로
// 런타임 전용 API를 쓰지 않고, 상대 경로 import에는 .ts 확장자를 붙인다.

export type ItemGroup = "fx" | "rates" | "stocks";

/**
 * 표시 중인 값의 성격.
 * - live: 장중 실시간 수집값
 * - hourly: 1시간마다 수집하는 값
 * - daily: 일 1회 수집값
 * - closed: 장 마감 후의 마지막 값
 * - sample: 실제 수집값이 아닌 샘플 데이터
 * 수집 실패 여부는 status가 아니라 error 필드로 표시한다(값은 유지하고 오류 배지만 붙이기 위함).
 */
export type ItemStatus = "live" | "hourly" | "daily" | "closed" | "sample";

/**
 * 환율·금리 provider의 수집 주기.
 * - hour: 매시 정각이 지난 뒤 첫 실행에서 1회
 * - day: 하루 한 번, atKst(KST, HH:MM) 이후 첫 실행에서 1회
 */
export type Cadence = { every: "hour" } | { every: "day"; atKst: string };

/** prev: 시계열의 직전 관측치 대비, policy: 기준금리의 최근 변경일과 변경폭 */
export type ChangeKind = "prev" | "policy";

export interface IndicatorItem {
  id: string;
  group: ItemGroup;
  value: number | null;
  /** 환율: 원, 금리: %p, 증시: 포인트. 기준금리는 최근 변경폭 */
  change: number | null;
  /** 등락률(%). 환율과 증시에만 채운다 */
  changePct: number | null;
  changeKind: ChangeKind;
  /** 기준금리의 최근 변경일(YYYY-MM-DD) */
  changedOn: string | null;
  /** 데이터 기준시각. minute이면 ISO 8601 시각, day이면 YYYY-MM-DD */
  asOf: string | null;
  asOfPrecision: "minute" | "day";
  status: ItemStatus;
  /** 마지막 수집 시도가 실패했을 때의 사유. 성공하면 null */
  error: string | null;
  /** 값을 만든 provider id */
  source: string;
}

/** 제목과 링크만 저장한다. 본문, 요약, 이미지는 수집하지 않는다 */
export interface NewsItem {
  press: string;
  title: string;
  link: string;
}

export interface NewsBlock {
  /** 언론사가 번갈아 나오도록 섞은 결과 */
  items: NewsItem[];
  /** 언론사별 마지막 성공분. 일부 피드가 실패해도 이전 값을 유지하는 데 쓴다 */
  byPress: Record<string, NewsItem[]>;
  fetchedAt: string | null;
  failed: { press: string; error: string }[];
}

export interface SourceState {
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  /** 차단 또는 형식 변경을 감지했을 때 이 시각까지 원천을 호출하지 않는다 */
  cooldownUntil: string | null;
}

export interface MarketSnapshot {
  schema: 1;
  /** 수집기가 이 JSON을 마지막으로 기록한 시각 */
  generatedAt: string;
  items: Record<string, IndicatorItem>;
  news: NewsBlock;
  sources: Record<string, SourceState>;
}

export interface Session {
  timeZone: string;
  /** HH:MM, 해당 시간대 기준 */
  open: string;
  close: string;
}

export interface StockMarket {
  id: string;
  sourceId: string;
  itemIds: string[];
  session: Session;
  /** false이면 원천을 호출하지 않고 샘플 데이터로 둔다 */
  enabled: boolean;
}

export interface NewsFeed {
  press: string;
  url: string;
}

export type Logger = (line: string) => void;

export interface HttpResponse {
  status: number;
  text: string;
}

export interface HttpClient {
  /** 원천 호출 누계. 호출 횟수 검증에 쓴다 */
  calls: number;
  get(url: string, opts: { source: string; logUrl?: string; timeoutMs?: number }): Promise<HttpResponse>;
}

export interface ProviderContext {
  now: Date;
  http: HttpClient;
  log: Logger;
}

/** 증시 provider가 돌려주는 공통 형식 */
export interface IndexQuote {
  id: string;
  value: number;
  change: number;
  changePct: number;
  /** ISO 8601 */
  asOf: string;
  /** 거래소가 알려 준 개장 여부 */
  marketOpen: boolean;
  /** provider가 모의 값을 돌려줄 때 true. 화면에는 샘플 배지가 붙는다 */
  sample?: boolean;
}

/**
 * 증시 지수 provider.
 * 한국투자증권 Open API로 교체할 때는 이 인터페이스를 구현한 파일을 추가하고
 * providers/index.ts의 등록 한 줄만 바꾼다.
 */
export interface StockIndexProvider {
  id: string;
  /** 같은 시장에 속한 항목들을 한 번에 조회한다. 호출 횟수는 provider가 최소화한다 */
  fetchQuotes(itemIds: string[], ctx: ProviderContext): Promise<IndexQuote[]>;
}

export interface IndicatorResult {
  id: string;
  value: number;
  change: number | null;
  changePct: number | null;
  changeKind: ChangeKind;
  changedOn: string | null;
  /** 일 단위이면 YYYY-MM-DD, 분 단위이면 ISO 8601 시각 */
  asOf: string;
  /** 생략하면 일 단위 */
  asOfPrecision?: "minute" | "day";
}

/**
 * 환율·금리 provider. 주기(cadence)에 따라 매시간 또는 하루 한 번 수집한다.
 * 같은 항목을 여러 provider가 다룰 수 있으며, 등록 순서가 앞선 사용 가능한 provider가 그 항목을 맡는다.
 */
export interface IndicatorProvider {
  id: string;
  /** 필요한 API 키의 환경변수 이름. 키가 없으면 이 provider는 쓰지 않는다. 키가 필요 없는 소스는 null */
  envKey: string | null;
  itemIds: string[];
  cadence: Cadence;
  /** itemIds는 이번에 이 provider가 맡은 항목. 그 항목의 값만 돌려주면 된다 */
  fetch(ctx: ProviderContext, apiKey: string, itemIds: string[]): Promise<IndicatorResult[]>;
}

export interface NewsProvider {
  id: string;
  fetchFeed(feed: NewsFeed, ctx: ProviderContext): Promise<NewsItem[]>;
}

export interface Providers {
  stockIndex: StockIndexProvider;
  indicators: IndicatorProvider[];
  news: NewsProvider;
}
