// 캐시 JSON의 형식은 수집기 쪽 정의를 그대로 쓴다(타입만 가져오므로 번들에 수집기 코드가 들어가지 않는다).
export type {
  IndicatorItem,
  ItemGroup,
  ItemStatus,
  MarketSnapshot,
  NewsItem,
} from "../../supabase/functions/_shared/market/types.ts";
