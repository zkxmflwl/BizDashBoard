import { useQuery } from "@tanstack/react-query";
import { MARKET_CACHE_POLL_MS } from "@/config/marketConfig";
import { fetchMarketSnapshot } from "@/services/marketCacheService";

/**
 * 캐시 JSON을 60초마다 다시 읽는다. 페이지를 새로 고치지 않고 데이터만 교체한다.
 * 읽기에 실패하면 마지막으로 읽은 값을 그대로 두고 isError만 true가 된다.
 * 값이 같은 항목은 객체 참조가 유지되므로(React Query의 구조 공유) 바뀐 항목만 다시 그려진다.
 */
export function useMarketCache() {
  return useQuery({
    queryKey: ["market-cache"],
    queryFn: fetchMarketSnapshot,
    refetchInterval: MARKET_CACHE_POLL_MS,
    // 탭이 가려져 있어도 같은 주기로 읽고, 탭으로 돌아올 때 추가로 읽지는 않는다(탭당 60초에 1회).
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: false,
    staleTime: 0,
    retry: 0,
  });
}
