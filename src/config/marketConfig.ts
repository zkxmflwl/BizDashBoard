// 경제지표·뉴스 테스트 화면 설정.
// 항목의 표시 이름, 단위, 외부 상세 페이지 링크는 이 파일 한 곳에서만 관리한다.

import type { ItemGroup } from "@/types/market";

export const MARKET_TEST_PATH = "/market-test";

/** 화면이 캐시 JSON을 다시 읽는 주기 */
export const MARKET_CACHE_POLL_MS = 60_000;

/** 헤드라인 전환 주기. 수집 주기(10분)와는 별개다 */
export const NEWS_ROTATE_MS = 5_000;

/** 수집기 기록 시각이 이보다 오래되면 수집기가 멈춘 것으로 안내한다 */
export const COLLECTOR_STALE_MS = 3 * 60_000;

export interface MarketItemConfig {
  id: string;
  label: string;
  /** 이름 뒤에 괄호로 붙는 보조 설명. 카드가 좁으면 이 부분만 다음 줄로 내려간다 */
  note?: string;
  /** 값 뒤에 붙는 단위 */
  unit: string;
  /** 값과 변동의 소수 자리수 */
  decimals: number;
  /** 변동 뒤에 붙는 단위. 금리는 %p */
  changeUnit: string;
  /** 새 탭으로 여는 외부 상세 페이지 */
  link: string;
}

export interface MarketGroupConfig {
  id: ItemGroup;
  title: string;
  items: MarketItemConfig[];
}

/** 화면에는 이 배열에 적힌 순서(환율, 증시, 금리)대로 나온다 */
export const MARKET_GROUPS: MarketGroupConfig[] = [
  {
    id: "fx",
    title: "환율",
    items: [
      {
        id: "usdkrw",
        label: "원/달러",
        unit: "원",
        decimals: 2,
        changeUnit: "",
        link: "https://stock.naver.com/marketindex/exchange/FX_USDKRW/price",
      },
      {
        id: "jpykrw",
        label: "원/엔",
        note: "100엔",
        unit: "원",
        decimals: 2,
        changeUnit: "",
        link: "https://stock.naver.com/marketindex/exchange/FX_JPYKRW/price",
      },
      {
        id: "cnykrw",
        label: "원/위안",
        unit: "원",
        decimals: 2,
        changeUnit: "",
        link: "https://stock.naver.com/marketindex/exchange/FX_CNYKRW/price",
      },
    ],
  },
  {
    id: "stocks",
    title: "증시",
    items: [
      {
        id: "kospi",
        label: "코스피",
        unit: "",
        decimals: 2,
        changeUnit: "",
        link: "https://stock.naver.com/domestic/index/KOSPI/price",
      },
      {
        id: "kosdaq",
        label: "코스닥",
        unit: "",
        decimals: 2,
        changeUnit: "",
        link: "https://stock.naver.com/domestic/index/KOSDAQ/price",
      },
      {
        id: "nasdaq",
        label: "나스닥",
        unit: "",
        decimals: 2,
        changeUnit: "",
        link: "https://stock.naver.com/worldstock/index/.IXIC/price",
      },
    ],
  },
  {
    id: "rates",
    title: "금리",
    items: [
      {
        id: "krBaseRate",
        label: "한국 기준금리",
        unit: "%",
        decimals: 2,
        changeUnit: "%p",
        link: "https://www.bok.or.kr/portal/singl/baseRate/list.do?dataSeCd=01&menuNo=200643",
      },
      {
        id: "usPolicyRate",
        label: "미국 기준금리",
        note: "상단",
        unit: "%",
        decimals: 2,
        changeUnit: "%p",
        link: "https://fred.stlouisfed.org/series/DFEDTARU",
      },
      {
        id: "ktb3y",
        label: "국고채 3년",
        note: "대표 시장금리",
        unit: "%",
        decimals: 3,
        changeUnit: "%p",
        link: "https://stock.naver.com/marketindex/bond/KR3YT=RR",
      },
      {
        id: "ust10y",
        label: "미 국채 10년",
        note: "대표 시장금리",
        unit: "%",
        decimals: 3,
        changeUnit: "%p",
        link: "https://stock.naver.com/marketindex/bond/US10YT=RR",
      },
    ],
  },
];
