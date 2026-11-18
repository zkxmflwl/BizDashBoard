// 뉴스 provider: 언론사 경제 섹션 RSS.
// 제목과 링크만 꺼낸다. description, content:encoded, 이미지는 읽지 않고 버린다.
// 발행일은 최신순 정렬과 피드 갱신 여부 확인에만 쓰고 저장하지 않는다.

import { NEWS_MAX_AGE_DAYS, NEWS_PER_PRESS } from "../config.ts";
import { assertOk, SourceError } from "../http.ts";
import type { NewsFeed, NewsItem, NewsProvider, ProviderContext } from "../types.ts";

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, name: string) => {
    const key = name.toLowerCase();
    if (!key.startsWith("#")) return ENTITIES[key] ?? match;
    const code = key.startsWith("#x") ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10);
    // 범위를 벗어난 문자 참조는 원문 그대로 둔다.
    return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
  });
}

/** 태그 하나의 내용을 꺼낸다. CDATA를 풀고 엔티티를 해석한다 */
function tagText(block: string, tag: string): string | null {
  const m = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`));
  if (!m) return null;
  const raw = m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  return decodeEntities(raw).trim();
}

/** HTML 태그만 지운다. 제목에 쓰인 "<표>" 같은 꺾쇠 문구는 남긴다 */
function cleanTitle(text: string): string {
  return text.replace(/<\/?[a-zA-Z][^>]*>/g, "").replace(/\s+/g, " ").trim();
}

/** http(s) 주소만 통과시킨다. 주소 안의 공백은 %20으로 바꾼다 */
function cleanLink(text: string): string | null {
  const link = text.replace(/\s/g, "%20");
  try {
    const url = new URL(link);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

/** RSS 본문에서 최신 기사 NEWS_PER_PRESS건의 제목과 링크를 뽑는다 */
export function parseRss(xml: string, press: string, now: Date): NewsItem[] {
  // 일부 피드는 맨 앞에 BOM(U+FEFF)이 붙어 있다.
  const body = xml.charCodeAt(0) === 0xfeff ? xml.slice(1) : xml;
  const blocks = body.match(/<item[\s>][\s\S]*?<\/item>/g) ?? [];

  const rows: { item: NewsItem; publishedAt: number | null }[] = [];
  for (const block of blocks) {
    const title = cleanTitle(tagText(block, "title") ?? "");
    const link = cleanLink(tagText(block, "link") ?? "");
    if (!title || !link) continue;
    const published = Date.parse(tagText(block, "pubDate") ?? tagText(block, "dc:date") ?? "");
    rows.push({ item: { press, title, link }, publishedAt: Number.isNaN(published) ? null : published });
  }
  if (rows.length === 0) throw new SourceError("format", "RSS에서 기사 항목을 찾지 못했습니다");

  // 모든 항목에 발행일이 있으면 최신순으로 정렬한다. 없으면 피드에 실린 순서를 따른다.
  const allDated = rows.every((r) => r.publishedAt !== null);
  if (allDated) {
    rows.sort((a, b) => (b.publishedAt as number) - (a.publishedAt as number));
    const ageDays = (now.getTime() - (rows[0].publishedAt as number)) / 86_400_000;
    if (ageDays > NEWS_MAX_AGE_DAYS) {
      throw new SourceError("format", `최신 기사가 ${Math.floor(ageDays)}일 전입니다(갱신이 멈춘 피드)`);
    }
  }

  const seen = new Set<string>();
  const picked: NewsItem[] = [];
  for (const { item } of rows) {
    if (seen.has(item.link)) continue;
    seen.add(item.link);
    picked.push(item);
    if (picked.length === NEWS_PER_PRESS) break;
  }
  return picked;
}

/** 언론사가 번갈아 나오도록 섞는다: A1, B1, C1, A2, B2, C2 … */
export function interleave(lists: NewsItem[][]): NewsItem[] {
  const out: NewsItem[] = [];
  const longest = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < longest; i += 1) {
    for (const list of lists) {
      if (list[i]) out.push(list[i]);
    }
  }
  return out;
}

export const rssNewsProvider: NewsProvider = {
  id: "rss-news",

  async fetchFeed(feed: NewsFeed, ctx: ProviderContext): Promise<NewsItem[]> {
    const res = await ctx.http.get(feed.url, { source: `${this.id}:${feed.press}` });
    assertOk(res);
    return parseRss(res.text, feed.press, ctx.now);
  },
};
