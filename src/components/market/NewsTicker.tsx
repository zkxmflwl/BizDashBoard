import { useEffect, useState } from "react";
import { Newspaper } from "lucide-react";
import { NEWS_ROTATE_MS } from "@/config/marketConfig";
import type { NewsItem } from "@/types/market";

interface NewsTickerProps {
  items: NewsItem[];
  /** 수집에 실패한 언론사 */
  failed: { press: string; error: string }[];
}

/**
 * 언론사명과 기사 제목을 한 줄로 보여 주고 NEWS_ROTATE_MS마다 다음 헤드라인으로 넘긴다.
 * 수집 주기(10분)와는 무관하게 화면에서만 전환한다. 제목을 누르면 원문이 새 탭으로 열린다.
 */
export function NewsTicker({ items, failed }: NewsTickerProps) {
  const [index, setIndex] = useState(0);
  const count = items.length;

  useEffect(() => {
    if (count <= 1) return;
    const timer = window.setInterval(() => setIndex((i) => i + 1), NEWS_ROTATE_MS);
    return () => window.clearInterval(timer);
  }, [count]);

  const position = count > 0 ? index % count : 0;
  const current = items[position];

  return (
    <section className="glass-card flex items-center gap-3 rounded-xl px-4 py-3" aria-label="경제 뉴스">
      <span className="flex shrink-0 items-center gap-1.5 text-sm font-semibold text-primary">
        <Newspaper className="h-4 w-4" aria-hidden="true" />
        경제뉴스
      </span>

      <div className="min-w-0 flex-1">
        {current ? (
          <a
            key={current.link}
            href={current.link}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="news-headline"
            className="group flex min-w-0 items-center gap-2 text-sm animate-fade-in focus:outline-none focus-visible:underline"
          >
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
              {current.press}
            </span>
            <span className="truncate text-foreground group-hover:text-primary">{current.title}</span>
          </a>
        ) : (
          <p className="text-sm text-muted-foreground" data-testid="news-empty">
            표시할 뉴스가 없습니다.
          </p>
        )}
      </div>

      {failed.length > 0 && (
        <span
          title={failed.map((f) => `${f.press}: ${f.error}`).join("\n")}
          className="shrink-0 rounded-full border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive"
        >
          오류 {failed.length}곳
        </span>
      )}
      {count > 0 && (
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground" data-testid="news-position">
          {position + 1} / {count}
        </span>
      )}
    </section>
  );
}
