// 샘플 데이터. 항목을 맡을 소스가 없거나 비공식 원천이 차단·변경되었을 때 표시하며 화면에는 "샘플" 배지가 붙는다.
// 실제 시세가 아니므로 기준시각(asOf)은 비워 둔다.

import type { ChangeKind, IndicatorItem, ItemGroup } from "./types.ts";

function sample(
  id: string,
  group: ItemGroup,
  value: number,
  change: number,
  changePct: number | null,
  changeKind: ChangeKind = "prev",
  changedOn: string | null = null,
): IndicatorItem {
  return {
    id,
    group,
    value,
    change,
    changePct,
    changeKind,
    changedOn,
    asOf: null,
    asOfPrecision: group === "stocks" ? "minute" : "day",
    status: "sample",
    error: null,
    source: "sample",
  };
}

const SAMPLE_ITEMS: Record<string, IndicatorItem> = {
  usdkrw: sample("usdkrw", "fx", 1450.0, 3.5, 0.24),
  jpykrw: sample("jpykrw", "fx", 950.0, -2.1, -0.22),
  cnykrw: sample("cnykrw", "fx", 200.0, 0.0, 0.0),
  krBaseRate: sample("krBaseRate", "rates", 3.0, 0.25, null, "policy", "2026-01-01"),
  usPolicyRate: sample("usPolicyRate", "rates", 4.0, -0.25, null, "policy", "2026-01-01"),
  ktb3y: sample("ktb3y", "rates", 3.65, 0.012, null),
  ust10y: sample("ust10y", "rates", 4.1, -0.03, null),
  kospi: sample("kospi", "stocks", 5000.0, 25.0, 0.5),
  kosdaq: sample("kosdaq", "stocks", 650.0, -3.25, -0.5),
  nasdaq: sample("nasdaq", "stocks", 24000.0, 120.0, 0.5),
};

export const ALL_ITEM_IDS = Object.keys(SAMPLE_ITEMS);

export function sampleItem(id: string): IndicatorItem {
  const item = SAMPLE_ITEMS[id];
  if (!item) throw new Error(`샘플이 정의되지 않은 항목입니다: ${id}`);
  return { ...item };
}
