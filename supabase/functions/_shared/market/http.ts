import type { HttpClient, HttpResponse, Logger } from "./types.ts";

/**
 * 수집 실패의 종류.
 * - blocked: 원천이 요청을 거부함(401/403/429). 우회하지 않고 호출을 멈춘다
 * - format: 응답 형식이 예상과 다름(필드 누락, JSON 아님, 404 등)
 * - auth: API 키가 없거나 유효하지 않음
 * - transient: 네트워크 오류, 시간 초과, 5xx 등 일시적 실패
 */
export type SourceErrorKind = "blocked" | "format" | "auth" | "transient";

export class SourceError extends Error {
  kind: SourceErrorKind;

  constructor(kind: SourceErrorKind, message: string) {
    super(message);
    this.name = "SourceError";
    this.kind = kind;
  }
}

export function toSourceError(e: unknown): SourceError {
  if (e instanceof SourceError) return e;
  return new SourceError("transient", e instanceof Error ? e.message : String(e));
}

/**
 * 문자열에서 API 키 값을 가리는 함수를 만든다.
 * 로그와 캐시 JSON에 쓰기 직전에 한 번 더 거르는 방어선이다.
 */
export function createScrubber(env: Record<string, string | undefined>): (text: string) => string {
  const secrets = Object.values(env)
    .map((v) => (v ?? "").trim())
    .filter((v) => v.length >= 4);
  return (text) => {
    let out = text;
    for (const secret of secrets) {
      out = out.split(secret).join("***").split(encodeURIComponent(secret)).join("***");
    }
    return out;
  };
}

/**
 * 원천 호출 전용 HTTP 클라이언트.
 * 모든 호출을 한 줄씩 로그로 남기므로 로그만으로 호출 횟수를 셀 수 있다.
 * 요청 헤더는 런타임 기본값을 그대로 쓴다(User-Agent 등을 바꾸지 않는다).
 */
export function createHttpClient(log: Logger, fetchImpl: typeof fetch = fetch): HttpClient {
  const client: HttpClient = {
    calls: 0,
    async get(url, opts): Promise<HttpResponse> {
      client.calls += 1;
      const shown = opts.logUrl ?? url;
      const started = Date.now();
      try {
        const res = await fetchImpl(url, { signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000) });
        const text = await res.text();
        log(`SOURCE ${opts.source} GET ${shown} -> ${res.status} ${Date.now() - started}ms`);
        return { status: res.status, text };
      } catch (e) {
        // 런타임에 따라 예외 메시지에 요청 URL(키 포함)이 들어가므로 원문은 남기지 않고 종류만 기록한다.
        const name = e instanceof Error ? e.name : "";
        const reason = name === "TimeoutError" || name === "AbortError" ? "시간 초과" : "네트워크 오류";
        log(`SOURCE ${opts.source} GET ${shown} -> FAIL ${Date.now() - started}ms ${reason}`);
        throw new SourceError("transient", `요청 실패(${reason})`);
      }
    },
  };
  return client;
}

/** HTTP 상태 코드를 실패 종류로 바꾼다. 2xx이면 통과한다 */
export function assertOk(res: HttpResponse): void {
  if (res.status >= 200 && res.status < 300) return;
  if (res.status === 401 || res.status === 403 || res.status === 429) {
    throw new SourceError("blocked", `원천이 요청을 거부했습니다(HTTP ${res.status})`);
  }
  if (res.status >= 500) throw new SourceError("transient", `원천 서버 오류(HTTP ${res.status})`);
  throw new SourceError("format", `예상하지 못한 응답(HTTP ${res.status})`);
}

export function parseJson(text: string): unknown {
  const body = text.trim();
  if (body === "") return null;
  try {
    return JSON.parse(body);
  } catch {
    throw new SourceError("format", "응답이 JSON이 아닙니다");
  }
}

/** "1,234.5" 같은 문자열을 숫자로 바꾼다. 숫자가 아니면 null */
export function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/,/g, "").trim();
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** 부동소수 오차를 없애기 위해 소수 자리수를 맞춘다 */
export function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
