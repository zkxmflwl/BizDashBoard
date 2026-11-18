// provider 등록부. 수집기는 이 파일이 내보내는 것만 사용한다.

import { eximFxProvider } from "./fx.exim.ts";
import {
  naverFxProvider,
  naverKrBondProvider,
  naverPolicyRateProvider,
  naverUsBondProvider,
} from "./marketIndex.naver.ts";
import { rssNewsProvider } from "./news.rss.ts";
import { ecosRatesProvider } from "./rates.ecos.ts";
import { fredRatesProvider } from "./rates.fred.ts";
import { naverStockIndexProvider } from "./stockIndex.naver.ts";
import type { Providers } from "../types.ts";

export const defaultProviders: Providers = {
  // 증시 소스를 한국투자증권 Open API로 교체할 때는 StockIndexProvider를 구현한 파일
  // (예: ./stockIndex.kis.ts)을 추가하고 아래 한 줄만 바꾼다.
  stockIndex: naverStockIndexProvider,

  // 환율·금리는 앞에 적힌 provider가 우선한다.
  // 공식 API는 해당 키가 있을 때만 쓰이고, 키가 없는 항목은 네이버 시장지표 JSON이 맡는다.
  // 네이버 소스를 빼면 키가 없는 항목은 샘플 데이터로 표시된다.
  indicators: [
    eximFxProvider,
    ecosRatesProvider,
    fredRatesProvider,
    naverFxProvider,
    naverKrBondProvider,
    naverUsBondProvider,
    naverPolicyRateProvider,
  ],
  news: rssNewsProvider,
};
