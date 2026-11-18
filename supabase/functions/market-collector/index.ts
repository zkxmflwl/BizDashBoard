// 경제지표·뉴스 수집기의 배포 환경용 호스트(Supabase Edge Function).
// pg_cron이 1분마다 이 함수를 호출하고, 함수는 수집 결과를 Storage의 JSON 파일 하나로 저장한다.
// 화면은 그 JSON만 읽으므로 원천 호출 횟수는 접속자 수와 무관하다.
//
// 주의: 이 파일은 작성만 했고 아직 배포하거나 실행해 보지 않았다.
//       배포 절차와 필요한 SQL은 supabase/setup/market_collector_setup.sql을 참고한다.
// 배포 후 확인이 필요한 점
//   - 실행이 겹치지 않는지(잠금이 없다. 한 번의 실행이 60초를 넘기면 다음 실행과 겹칠 수 있다)
//   - Storage가 방금 저장한 파일을 바로 돌려주는지(오래된 사본을 읽으면 원천을 중복 호출한다)
//   두 가지가 문제가 되면 상태 저장을 Postgres 테이블(행 잠금)로 옮긴다.
//
// 필요한 함수 시크릿
//   MARKET_COLLECTOR_SECRET  cron 호출만 받기 위한 공유 비밀값(필수)
//   EXIM_API_KEY, ECOS_API_KEY, FRED_API_KEY  없으면 해당 항목은 네이버 시장지표 JSON을 사용

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { runCollector } from "../_shared/market/collector.ts";
import type { MarketSnapshot } from "../_shared/market/types.ts";

const BUCKET = "market-cache";
const FILE = "market.json";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

/** 새 형식의 secret 키가 있으면 그것을, 없으면 기존 service_role 키를 쓴다 */
function serviceKey(): string {
  try {
    const named = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}") as Record<string, string>;
    if (named.default) return named.default;
  } catch {
    // 형식이 다르면 기존 키로 넘어간다.
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}

Deno.serve(async (req) => {
  // 이 함수는 JWT 검증 없이 배포하므로(--no-verify-jwt) 공유 비밀값으로 호출자를 확인한다.
  const secret = Deno.env.get("MARKET_COLLECTOR_SECRET");
  if (!secret || req.headers.get("x-collector-secret") !== secret) {
    return json({ error: "forbidden" }, 403);
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey());
  const bucket = supabase.storage.from(BUCKET);

  const save = (body: string) =>
    bucket.upload(FILE, body, { upsert: true, contentType: "application/json", cacheControl: "0" });

  // 이전 캐시를 읽는다. 읽기에 실패하면 마지막 값과 호출 기록을 잃지 않도록 이번 실행을 건너뛴다.
  let prev: MarketSnapshot | null = null;
  const listed = await bucket.list("", { search: FILE });
  if (listed.error) return json({ error: `캐시 목록 조회 실패: ${listed.error.message}` }, 500);
  if (listed.data.some((f) => f.name === FILE)) {
    const downloaded = await bucket.download(FILE);
    if (downloaded.error) return json({ error: `캐시 읽기 실패: ${downloaded.error.message}` }, 500);
    try {
      prev = JSON.parse(await downloaded.data.text()) as MarketSnapshot;
    } catch {
      console.log("WARN 캐시 파일이 손상되어 새로 만듭니다");
    }
  }

  // 원천을 호출하기 전에 캐시를 쓸 수 있는지 먼저 확인한다.
  // 저장이 안 되는 상태에서 수집하면 마지막 시도 시각이 남지 않아 매분 원천을 다시 호출하게 된다.
  const writable = await save(JSON.stringify(prev ?? { schema: 1, generatedAt: "", items: {}, news: { items: [], byPress: {}, fetchedAt: null, failed: [] }, sources: {} }));
  if (writable.error) return json({ error: `캐시 쓰기 불가, 수집을 건너뜁니다: ${writable.error.message}` }, 500);

  const result = await runCollector(prev, {
    now: new Date(),
    env: {
      EXIM_API_KEY: Deno.env.get("EXIM_API_KEY"),
      ECOS_API_KEY: Deno.env.get("ECOS_API_KEY"),
      FRED_API_KEY: Deno.env.get("FRED_API_KEY"),
    },
    log: (line) => console.log(line), // 함수 로그에서 "SOURCE" 줄로 원천 호출 횟수를 확인한다
  });

  const uploaded = await save(JSON.stringify(result.snapshot));
  if (uploaded.error) return json({ error: `캐시 저장 실패: ${uploaded.error.message}` }, 500);

  console.log(`TICK 수집 시도=[${result.attempted.join(", ") || "없음"}] 원천 HTTP 호출=${result.sourceCalls}건`);
  return json({ attempted: result.attempted, sourceCalls: result.sourceCalls });
});
