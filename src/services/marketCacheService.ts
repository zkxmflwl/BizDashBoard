// 수집기가 기록한 캐시 JSON을 읽는다.
// 브라우저는 네이버, 수출입은행 같은 원천을 직접 호출하지 않고 이 캐시만 읽는다.

import { supabase } from "@/integrations/supabase/client";
import type { MarketSnapshot } from "@/types/market";

/** 로컬 수집기(scripts/market-dev-server.ts)의 기본 주소 */
const LOCAL_COLLECTOR_URL = "http://127.0.0.1:8787/market.json";

/** 배포 환경에서 수집기(Edge Function)가 기록하는 Supabase Storage 위치 */
const CACHE_BUCKET = "market-cache";
const CACHE_FILE = "market.json";

function resolveSource(): { url: string; authenticated: boolean } {
  const custom = import.meta.env.VITE_MARKET_CACHE_URL as string | undefined;
  if (custom) return { url: custom, authenticated: false };
  if (import.meta.env.DEV) return { url: LOCAL_COLLECTOR_URL, authenticated: false };
  return {
    url: `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/authenticated/${CACHE_BUCKET}/${CACHE_FILE}`,
    authenticated: true,
  };
}

export async function fetchMarketSnapshot(): Promise<MarketSnapshot> {
  const source = resolveSource();
  const headers: Record<string, string> = {};

  if (source.authenticated) {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("로그인 세션이 없습니다");
    headers.Authorization = `Bearer ${token}`;
    headers.apikey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  }

  const res = await fetch(source.url, { headers, cache: "no-store" });
  if (!res.ok) throw new Error(`캐시 응답 오류 (HTTP ${res.status})`);

  const body = (await res.json()) as MarketSnapshot;
  if (body?.schema !== 1 || !body.items || !body.news) throw new Error("캐시 형식이 올바르지 않습니다");
  return body;
}
