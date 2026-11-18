import { act, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ALL_ITEM_IDS, sampleItem } from "../../../supabase/functions/_shared/market/sample.ts";
import { MARKET_GROUPS } from "@/config/marketConfig";
import type { MarketSnapshot } from "@/types/market";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { getSession: vi.fn() } } }));

import MarketTest from "@/pages/MarketTest";

const NEWS = [
  { press: "오마이뉴스", title: "첫 번째 기사", link: "https://news.example/1" },
  { press: "경향신문", title: "두 번째 기사", link: "https://news.example/2" },
  { press: "동아일보", title: "세 번째 기사", link: "https://news.example/3" },
];

function makeSnapshot(kospi: number, generatedAt: string): MarketSnapshot {
  const items = Object.fromEntries(ALL_ITEM_IDS.map((id) => [id, sampleItem(id)]));
  items.kospi = { ...items.kospi, value: kospi, change: 98.96, changePct: 1.99, status: "live", asOf: "2026-11-18T01:00:00.000Z" };
  items.kosdaq = { ...items.kosdaq, value: 662.81, change: -12.75, changePct: -1.96, status: "closed", asOf: "2026-11-18T06:30:00.000Z" };
  items.nasdaq = { ...items.nasdaq, value: 24328.38, change: 0, changePct: 0, status: "closed", asOf: "2026-11-17T22:15:59.000Z" };
  items.usdkrw = { ...items.usdkrw, value: 1452.5, status: "daily", asOf: "2026-11-18", error: "원천 서버 오류(HTTP 500)" };
  items.krBaseRate = { ...items.krBaseRate, status: "daily", asOf: "2026-11-16", change: 0.25, changedOn: "2026-05-28" };
  items.jpykrw = { ...items.jpykrw, value: 836.06, status: "hourly", asOf: "2026-11-18T13:12:03.000Z", asOfPrecision: "minute" };
  return {
    schema: 1,
    generatedAt,
    items,
    news: { items: NEWS, byPress: {}, fetchedAt: generatedAt, failed: [] },
    sources: {},
  };
}

let current: MarketSnapshot;
let failNext = false;
const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
  if (failNext) return { ok: false, status: 503, json: async () => ({}) };
  return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(current)) };
});

/** 가짜 시계를 ms만큼 진행하고 그 사이에 끝난 비동기 작업을 화면에 반영한다 */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <MarketTest />
    </QueryClientProvider>,
  );
  await advance(20);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-18T10:00:05+09:00"));
  current = makeSnapshot(5067.44, "2026-11-18T01:00:01.000Z");
  failNext = false;
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("경제지표·뉴스 화면", () => {
  it("캐시 주소 한 곳만 읽고, 모든 지표가 설정 파일의 주소로 가는 새 탭 링크다", async () => {
    await renderPage();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:8787/market.json");

    const configs = MARKET_GROUPS.flatMap((g) => g.items);
    expect(configs).toHaveLength(10);
    for (const config of configs) {
      const card = screen.getByTestId(`indicator-${config.id}`);
      expect(card.tagName).toBe("A");
      expect(card).toHaveAttribute("href", config.link);
      expect(card).toHaveAttribute("target", "_blank");
      expect(card).toHaveAttribute("rel", "noopener noreferrer");
    }
  });

  it("상태 배지와 상승·하락·보합 표시를 구분한다", async () => {
    await renderPage();

    const kospi = screen.getByTestId("indicator-kospi");
    expect(kospi).toHaveTextContent("실시간");
    expect(kospi).toHaveTextContent("5,067.44");
    expect(kospi).toHaveTextContent("11/18 10:00 기준");
    const up = screen.getByTestId("change-kospi");
    expect(up).toHaveTextContent("▲");
    expect(up).toHaveTextContent("98.96 (+1.99%)");
    expect(up.className).toContain("text-red-500");

    const down = screen.getByTestId("change-kosdaq");
    expect(down).toHaveTextContent("▼");
    expect(down).toHaveTextContent("12.75 (-1.96%)");
    expect(down.className).toContain("text-blue-500");
    expect(screen.getByTestId("indicator-kosdaq")).toHaveTextContent("장 마감");

    expect(screen.getByTestId("change-nasdaq").className).toContain("text-muted-foreground");

    // 수집 실패: 마지막 값을 유지하고 오류 배지를 붙인다. 값의 성격(일 1회)은 함께 보여 준다.
    const usd = screen.getByTestId("indicator-usdkrw");
    expect(usd).toHaveTextContent("1,452.50");
    expect(usd).toHaveTextContent("오류");
    expect(usd).toHaveTextContent("일 1회");

    // 기준금리: 전일 대비가 아니라 최근 변경일과 변경폭
    const base = screen.getByTestId("indicator-krBaseRate");
    expect(base).toHaveTextContent("일 1회");
    expect(base).toHaveTextContent("0.25%p · 2026-05-28 변경");
    expect(base).toHaveTextContent("11/16 기준");

    // 1시간마다 수집하는 항목
    const jpy = screen.getByTestId("indicator-jpykrw");
    expect(jpy).toHaveTextContent("매시간");
    expect(jpy).toHaveTextContent("836.06");
    expect(jpy).toHaveTextContent("11/18 22:12 기준");

    expect(screen.getByTestId("indicator-ust10y")).toHaveTextContent("샘플");

    // 이름 뒤의 보조 설명
    expect(screen.getByTestId("indicator-ktb3y")).toHaveTextContent("국고채 3년(대표 시장금리)");
    expect(screen.getByTestId("indicator-ust10y")).toHaveTextContent("미 국채 10년(대표 시장금리)");
    expect(screen.getByTestId("indicator-usPolicyRate")).toHaveTextContent("미국 기준금리(상단)");
    expect(screen.getByTestId("indicator-jpykrw")).toHaveTextContent("원/엔(100엔)");
  });

  it("60초마다 캐시를 다시 읽어 페이지를 새로 고치지 않고 숫자만 바꾼다", async () => {
    await renderPage();
    const kospiCard = screen.getByTestId("indicator-kospi");
    const kosdaqValue = screen.getByTestId("value-kosdaq");
    const heading = screen.getByRole("heading", { level: 1 });

    current = makeSnapshot(5070.12, "2026-11-18T01:01:01.000Z");
    await advance(59_000);
    expect(fetchMock).toHaveBeenCalledTimes(1); // 아직 60초가 지나지 않음
    expect(screen.getByTestId("value-kospi")).toHaveTextContent("5,067.44");

    await advance(1_500);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("value-kospi")).toHaveTextContent("5,070.12");

    // 같은 DOM 노드가 그대로 남아 있다(다시 마운트되거나 페이지가 새로 로드되지 않았다).
    expect(screen.getByTestId("indicator-kospi")).toBe(kospiCard);
    expect(screen.getByTestId("value-kosdaq")).toBe(kosdaqValue);
    expect(screen.getByRole("heading", { level: 1 })).toBe(heading);

    current = makeSnapshot(5075.5, "2026-11-18T01:02:01.000Z");
    await advance(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(screen.getByTestId("value-kospi")).toHaveTextContent("5,075.50");
  });

  it("캐시를 읽지 못하면 마지막으로 읽은 값을 유지하고 안내한다", async () => {
    await renderPage();
    failNext = true;
    await advance(60_500);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("value-kospi")).toHaveTextContent("5,067.44");
    expect(screen.getByRole("status")).toHaveTextContent("마지막으로 읽은 값을 표시합니다");
  });

  it("뉴스는 5초마다 다음 헤드라인으로 넘어가고 원문이 새 탭으로 열린다", async () => {
    await renderPage();

    const first = screen.getByTestId("news-headline");
    expect(first).toHaveTextContent("오마이뉴스");
    expect(first).toHaveTextContent("첫 번째 기사");
    expect(first).toHaveAttribute("href", "https://news.example/1");
    expect(first).toHaveAttribute("target", "_blank");
    expect(screen.getByTestId("news-position")).toHaveTextContent("1 / 3");

    await advance(4_900);
    expect(screen.getByTestId("news-headline")).toHaveTextContent("첫 번째 기사");

    await advance(200);
    expect(screen.getByTestId("news-headline")).toHaveTextContent("경향신문");
    expect(screen.getByTestId("news-headline")).toHaveAttribute("href", "https://news.example/2");

    await advance(5_000);
    expect(screen.getByTestId("news-headline")).toHaveTextContent("세 번째 기사");

    await advance(5_000);
    expect(screen.getByTestId("news-headline")).toHaveTextContent("첫 번째 기사"); // 끝에서 처음으로
    expect(fetchMock).toHaveBeenCalledTimes(1); // 헤드라인 전환은 캐시를 다시 읽지 않는다
  });
});
