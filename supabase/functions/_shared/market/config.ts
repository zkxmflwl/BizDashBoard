import type { NewsFeed, StockMarket } from "./types.ts";

/** 증시 수집 주기. 시장별로 분당 1회를 넘지 않는다 */
export const STOCK_POLL_MS = 60_000;

/** 뉴스 수집 주기. 화면의 헤드라인 전환 주기(5초)와는 별개다 */
export const NEWS_POLL_MS = 10 * 60_000;

export const NEWS_PER_PRESS = 5;

/** 발행일이 있는 피드에서 최신 기사가 이보다 오래되면 갱신이 멈춘 피드로 보고 제외한다 */
export const NEWS_MAX_AGE_DAYS = 3;

/** 차단(401/403/429) 또는 형식 변경을 감지한 뒤 원천을 다시 호출하기까지 기다리는 시간 */
export const BLOCK_COOLDOWN_MS = 30 * 60_000;

/** 일 1회 수집이 실패했을 때 재시도 간격. 매시간 수집은 다음 정각에 다시 시도한다 */
export const DAILY_RETRY_MS = 60 * 60_000;

/**
 * 캐시에 실제 지수 값이 한 번도 없을 때에 한해, 거래시간 밖이어도 시장별로 1회 조회한다.
 * "마지막 값 + 장 마감" 표시에 쓸 값을 확보하기 위한 것이며, false로 두면 다음 개장 전까지 샘플로 표시한다.
 */
export const SEED_STOCKS_WHEN_EMPTY = true;

/**
 * 증시 수집 시간대. 거래시간 안에서만 분당 1회 조회한다.
 * 한국: 평일 09:00~15:30 KST, 미국: 평일 09:30~16:00 뉴욕 시각(서머타임은 시간대 계산으로 자동 반영).
 */
export const STOCK_MARKETS: StockMarket[] = [
  {
    id: "kr",
    sourceId: "stocks:kr",
    itemIds: ["kospi", "kosdaq"],
    session: { timeZone: "Asia/Seoul", open: "09:00", close: "15:30" },
    enabled: true,
  },
  {
    id: "us",
    sourceId: "stocks:us",
    itemIds: ["nasdaq"],
    session: { timeZone: "America/New_York", open: "09:30", close: "16:00" },
    enabled: true,
  },
];

/**
 * 경제 섹션 RSS. 2026-11-18에 실제 요청으로 검증한 주소만 둔다.
 * 한겨레는 항목에 발행일이 없어 피드에 실린 순서를 최신순으로 본다.
 */
export const NEWS_FEEDS: NewsFeed[] = [
  { press: "오마이뉴스", url: "https://rss.ohmynews.com/rss/economy.xml" },
  { press: "경향신문", url: "https://www.khan.co.kr/rss/rssdata/economy_news.xml" },
  { press: "동아일보", url: "https://rss.donga.com/economy.xml" },
  { press: "한겨레", url: "https://www.hani.co.kr/rss/economy" },
  { press: "조선일보", url: "https://www.chosun.com/arc/outboundfeeds/rss/category/economy/?outputType=xml" },
];

export const NEWS_SOURCE_ID = "news";
