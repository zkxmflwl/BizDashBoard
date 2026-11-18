import { memo } from "react";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MarketItemConfig } from "@/config/marketConfig";
import type { IndicatorItem, ItemStatus } from "@/types/market";
import { formatAsOf, formatNumber, formatSigned, trendOf, type Trend } from "@/utils/marketFormat";

const STATUS_LABEL: Record<ItemStatus, string> = {
  live: "실시간",
  hourly: "매시간",
  daily: "일 1회",
  closed: "장 마감",
  sample: "샘플",
};

const STATUS_CLASS: Record<ItemStatus, string> = {
  live: "border-success/30 bg-success/10 text-success",
  hourly: "border-primary/30 bg-primary/10 text-primary",
  daily: "border-primary/30 bg-primary/10 text-primary",
  closed: "border-border bg-muted text-muted-foreground",
  sample: "border-warning/40 bg-warning/15 text-foreground",
};

const ERROR_CLASS = "border-destructive/30 bg-destructive/10 text-destructive";

// 상승은 빨강, 하락은 파랑, 보합은 회색. 기존 StatCard와 같은 색을 쓴다.
const TREND_CLASS: Record<Trend, string> = {
  up: "text-red-500",
  down: "text-blue-500",
  flat: "text-muted-foreground",
};

const TREND_MARK: Record<Trend, string> = { up: "▲", down: "▼", flat: "–" };

function Pill({ className, title, children }: { className: string; title?: string; children: string }) {
  return (
    <span
      title={title}
      className={cn("inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium", className)}
    >
      {children}
    </span>
  );
}

function ChangeLine({ config, item }: { config: MarketItemConfig; item: IndicatorItem }) {
  if (item.change === null) {
    return (
      <p className="text-sm text-muted-foreground" data-testid={`change-${config.id}`}>
        {item.changeKind === "policy" ? "최근 변경 내역 없음" : "–"}
      </p>
    );
  }

  const trend = trendOf(item.change);
  const amount = `${formatNumber(Math.abs(item.change), config.decimals)}${config.changeUnit}`;

  return (
    <p className={cn("text-sm font-medium tabular-nums", TREND_CLASS[trend])} data-testid={`change-${config.id}`}>
      <span aria-hidden="true">{TREND_MARK[trend]}</span>{" "}
      <span className="sr-only">{trend === "up" ? "상승" : trend === "down" ? "하락" : "보합"}</span>
      {amount}
      {item.changePct !== null && <span> ({formatSigned(item.changePct, 2)}%)</span>}
      {item.changeKind === "policy" && item.changedOn && (
        <span className="font-normal text-muted-foreground"> · {item.changedOn} 변경</span>
      )}
    </p>
  );
}

interface IndicatorCardProps {
  config: MarketItemConfig;
  item: IndicatorItem | undefined;
}

/**
 * 지표 하나. 카드 전체가 외부 상세 페이지로 가는 새 탭 링크다.
 * memo로 감싸 두었으므로 캐시를 다시 읽어도 값이 바뀐 카드만 다시 그려진다.
 */
function IndicatorCardInner({ config, item }: IndicatorCardProps) {
  const asOf = item ? formatAsOf(item) : null;

  return (
    <a
      href={config.link}
      target="_blank"
      rel="noopener noreferrer"
      data-testid={`indicator-${config.id}`}
      className="glass-card group block rounded-xl px-4 py-3.5 transition-colors hover:border-primary/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="flex items-center gap-1 text-sm text-muted-foreground">
          {config.label}
          <ExternalLink className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-60" aria-hidden="true" />
        </p>
        <div className="flex flex-wrap justify-end gap-1">
          {item ? (
            <>
              {/* 수집에 실패한 값을 실시간이라고 표시하지 않는다. 장 마감, 일 1회, 샘플은 오류와 함께 표시한다 */}
              {!(item.status === "live" && item.error) && (
                <Pill className={STATUS_CLASS[item.status]}>{STATUS_LABEL[item.status]}</Pill>
              )}
              {item.error && (
                <Pill className={ERROR_CLASS} title={item.error}>
                  오류
                </Pill>
              )}
            </>
          ) : (
            <Pill className={ERROR_CLASS} title="캐시에 이 항목이 없습니다">
              오류
            </Pill>
          )}
        </div>
      </div>

      <p className="mt-1.5 text-2xl font-bold tabular-nums text-foreground" data-testid={`value-${config.id}`}>
        {item && item.value !== null ? formatNumber(item.value, config.decimals) : "–"}
        {config.unit && <span className="ml-1 text-sm font-medium text-muted-foreground">{config.unit}</span>}
      </p>

      <div className="mt-0.5 min-h-5">{item && <ChangeLine config={config} item={item} />}</div>

      <p className="mt-1.5 text-xs text-muted-foreground">
        {asOf ?? (item?.status === "sample" ? "샘플 데이터 (기준시각 없음)" : "기준시각 없음")}
      </p>
    </a>
  );
}

export const IndicatorCard = memo(IndicatorCardInner);
