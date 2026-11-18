import { AlertTriangle } from "lucide-react";
import { IndicatorCard } from "@/components/market/IndicatorCard";
import { NewsTicker } from "@/components/market/NewsTicker";
import { COLLECTOR_STALE_MS, MARKET_GROUPS } from "@/config/marketConfig";
import { useMarketCache } from "@/hooks/useMarketCache";
import { formatClock } from "@/utils/marketFormat";

function Notice({ children }: { children: string }) {
  return (
    <div
      role="status"
      className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}

/**
 * 경제지표와 경제뉴스 테스트 화면.
 * 화면은 수집기가 기록한 캐시 JSON만 읽고, 60초마다 다시 읽어 바뀐 숫자만 교체한다.
 */
export default function MarketTest() {
  const { data, isError, error, isPending, dataUpdatedAt } = useMarketCache();

  const collectorStale =
    !!data && dataUpdatedAt - Date.parse(data.generatedAt) > COLLECTOR_STALE_MS;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">경제지표 · 뉴스</h1>
          <p className="mt-1 text-sm text-muted-foreground">테스트 화면 · 최초관리자 전용</p>
        </div>
        <p className="text-xs tabular-nums text-muted-foreground" data-testid="cache-times">
          수집기 기록 {formatClock(data?.generatedAt)} · 화면 갱신 {formatClock(dataUpdatedAt || null)} (60초 주기)
        </p>
      </div>

      {isError && (
        <Notice>
          {data
            ? `캐시를 다시 읽지 못해 마지막으로 읽은 값을 표시합니다. (${(error as Error).message})`
            : `캐시를 읽지 못했습니다. 수집기가 실행 중인지 확인해 주세요. (${(error as Error).message})`}
        </Notice>
      )}
      {!isError && collectorStale && (
        <Notice>{`수집기 기록이 ${formatClock(data?.generatedAt)} 이후 갱신되지 않았습니다. 표시된 값이 최신이 아닐 수 있습니다.`}</Notice>
      )}

      <NewsTicker items={data?.news.items ?? []} failed={data?.news.failed ?? []} />

      {isPending ? (
        <p className="text-sm text-muted-foreground">캐시를 읽는 중입니다.</p>
      ) : (
        <div className="space-y-5">
          {MARKET_GROUPS.map((group) => (
            <section key={group.id} aria-label={group.title}>
              <h2 className="mb-2 text-sm font-semibold text-muted-foreground">{group.title}</h2>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {group.items.map((config) => (
                  <IndicatorCard key={config.id} config={config} item={data?.items[config.id]} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
