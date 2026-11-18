// 로컬 테스트용 수집기 호스트. Node 24 이상에서 그대로 실행한다.
//
//   node scripts/market-dev-server.ts              실제 수집. 키가 없는 환율·금리는 네이버 시장지표 JSON을 매시간 사용
//   node scripts/market-dev-server.ts --simulate   지수 원천을 호출하지 않고 모의 값으로 1분 갱신을 확인
//   node scripts/market-dev-server.ts --once       한 번만 수집하고 종료
//   옵션: --port=8787
//
// 역할
//   1) 1분마다 수집기를 한 번 실행한다. 원천 호출은 여기서만 일어난다.
//   2) 결과를 node_modules/.cache/market-test/market.json에 저장한다(재시작해도 마지막 값 유지).
//   3) http://127.0.0.1:<port>/market.json으로 캐시 JSON만 내보낸다. 화면은 이 JSON만 읽는다.
// 로그의 "SOURCE" 줄은 원천 호출, "CACHE" 줄은 화면의 캐시 읽기다.
// API 키는 환경변수(EXIM_API_KEY, ECOS_API_KEY, FRED_API_KEY) 또는 .env.local에서만 읽는다.

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { runCollector } from "../supabase/functions/_shared/market/collector.ts";
import { round } from "../supabase/functions/_shared/market/http.ts";
import { formatKst } from "../supabase/functions/_shared/market/time.ts";
import type { MarketSnapshot, StockIndexProvider } from "../supabase/functions/_shared/market/types.ts";

const args = process.argv.slice(2);
const simulate = args.includes("--simulate");
const once = args.includes("--once");
const port = Number(args.find((a) => a.startsWith("--port="))?.split("=")[1] ?? 8787);

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE_DIR = resolve(ROOT, "node_modules/.cache/market-test");
// 모의 값이 실제 캐시에 섞이지 않도록 모의 실행은 별도 파일에 저장한다.
const CACHE_FILE = resolve(CACHE_DIR, simulate ? "market.simulate.json" : "market.json");
const LOG_FILE = resolve(CACHE_DIR, "collector.log");
const API_KEY_NAMES = ["EXIM_API_KEY", "ECOS_API_KEY", "FRED_API_KEY"];

// 이미 설정된 환경변수가 우선한다. 먼저 읽은 파일의 값이 유지되므로 .env.local이 .env보다 우선한다.
for (const name of [".env.local", ".env"]) {
  const file = resolve(ROOT, name);
  if (existsSync(file)) process.loadEnvFile(file);
}
const env: Record<string, string | undefined> = {};
for (const name of API_KEY_NAMES) env[name] = process.env[name];

mkdirSync(CACHE_DIR, { recursive: true });

function log(line: string): void {
  const text = `[${formatKst(new Date())}] ${line}`;
  console.log(text);
  appendFileSync(LOG_FILE, `${text}\n`);
}

function loadSnapshot(): MarketSnapshot | null {
  try {
    return JSON.parse(readFileSync(CACHE_FILE, "utf8")) as MarketSnapshot;
  } catch {
    return null;
  }
}

function saveSnapshot(snap: MarketSnapshot): void {
  const tmp = `${CACHE_FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(snap));
  renameSync(tmp, CACHE_FILE);
}

let snapshot = loadSnapshot();

/** 모의 지수 provider. 원천을 호출하지 않고 현재 값을 조금씩 움직인다. 값에는 샘플 표시가 붙는다 */
const simulatedProvider: StockIndexProvider = {
  id: "simulated-index",
  fetchQuotes(itemIds, ctx) {
    ctx.log(`SOURCE simulated-index 모의 조회 ${itemIds.join(",")} (실제 원천 호출 없음)`);
    return Promise.resolve(
      itemIds.map((id) => {
        const current = snapshot?.items[id];
        const base = current?.value ?? 1000;
        const previousClose = base - (current?.change ?? 0);
        const value = round(base * (1 + (Math.random() - 0.5) * 0.004), 2);
        const change = round(value - previousClose, 2);
        return {
          id,
          value,
          change,
          changePct: round((change / previousClose) * 100, 2),
          asOf: ctx.now.toISOString(),
          marketOpen: true,
          sample: true,
        };
      }),
    );
  },
};

let running = false;
async function tick(): Promise<void> {
  if (running) return; // 이전 실행이 끝나지 않았으면 건너뛴다
  running = true;
  try {
    const result = await runCollector(snapshot, {
      now: new Date(),
      env,
      log,
      providers: simulate ? { stockIndex: simulatedProvider } : undefined,
      forceStockSessionOpen: simulate,
    });
    snapshot = result.snapshot;
    saveSnapshot(snapshot);
    log(`TICK 수집 시도=[${result.attempted.join(", ") || "없음"}] 원천 HTTP 호출=${result.sourceCalls}건`);
  } catch (e) {
    log(`ERROR 수집기 실행 실패: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
  } finally {
    running = false;
  }
}

function scheduleNextTick(): void {
  // 매 분 1초에 맞춰 실행한다.
  const delay = 60_000 - (Date.now() % 60_000) + 1_000;
  setTimeout(() => {
    void tick().then(scheduleNextTick);
  }, delay);
}

log(
  `START 로컬 수집기 mode=${simulate ? "simulate(지수 모의)" : "real"} ` +
    API_KEY_NAMES.map((n) => `${n}=${env[n]?.trim() ? "설정됨" : "없음(네이버 시장지표 사용)"}`).join(" "),
);

await tick();

if (once) {
  const s = snapshot;
  if (s) {
    for (const item of Object.values(s.items)) {
      console.log(
        `  ${item.id.padEnd(13)} ${String(item.value).padStart(10)} ${String(item.change).padStart(8)} ` +
          `${item.status.padEnd(7)} asOf=${item.asOf ?? "-"}${item.error ? ` error=${item.error}` : ""}`,
      );
    }
    console.log(`  news=${s.news.items.length}건 실패=${s.news.failed.map((f) => f.press).join(",") || "없음"}`);
  }
  process.exit(0);
}

let reads = 0;
const server = createServer((req, res) => {
  const { pathname } = new URL(req.url ?? "/", "http://127.0.0.1");
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Methods": "GET", "Access-Control-Allow-Headers": "*" });
    res.end();
    return;
  }
  if (req.method === "GET" && pathname === "/market.json") {
    reads += 1;
    log(`CACHE 읽기 #${reads} origin=${req.headers.origin ?? "-"}`);
    if (!snapshot) {
      res.writeHead(503, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "아직 수집된 캐시가 없습니다" }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify(snapshot));
    return;
  }
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("not found");
});

server.listen(port, "127.0.0.1", () => {
  log(`LISTEN http://127.0.0.1:${port}/market.json`);
  scheduleNextTick();
});
