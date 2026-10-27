import { describe, expect, it } from "vitest";
import {
  computeCampaignMetrics,
  computeCampaignMetricsFromCounts,
  type MetricEvent,
} from "./metrics";
import { variantStats, variantStatsFromCounts } from "./abtest";

/**
 * The counts-based aggregation helpers (Phase 5) must return exactly
 * what the row-based engines return on the same data; the analytics
 * page and stats routes rely on that equivalence to aggregate in
 * the database instead of loading every event row.
 */

interface RichEvent extends MetricEvent {
  variant?: string | null;
}

const EVENTS: RichEvent[] = [
  ...Array.from({ length: 40 }, () => ({ type: "SENT" as const, variant: "A" })),
  ...Array.from({ length: 35 }, () => ({ type: "DELIVERED" as const, variant: "A" })),
  ...Array.from({ length: 10 }, () => ({
    type: "REPLIED" as const,
    classification: "POSITIVE",
    variant: "A",
  })),
  ...Array.from({ length: 4 }, () => ({
    type: "REPLIED" as const,
    classification: "NEUTRAL",
    variant: "B",
  })),
  ...Array.from({ length: 3 }, () => ({ type: "BOUNCED" as const, variant: null })),
  ...Array.from({ length: 2 }, () => ({ type: "OPENED" as const, variant: "A" })),
  { type: "CLICKED", variant: "B" },
  { type: "UNSUBSCRIBED", classification: null, variant: "A" },
  { type: "COMPLAINED", variant: "B" },
  // FAILED rows exist in the event table and both engines ignore them.
  { type: "FAILED" as MetricEvent["type"], variant: "A" },
];

function groupCounts<T extends Record<string, string | null>>(
  events: RichEvent[],
  pick: (event: RichEvent) => T,
): (T & { count: number })[] {
  const map = new Map<string, T & { count: number }>();
  for (const event of events) {
    const picked = pick(event);
    const signature = JSON.stringify(picked);
    const row = map.get(signature) ?? { ...picked, count: 0 };
    row.count += 1;
    map.set(signature, row);
  }
  return [...map.values()];
}

describe("counts-based aggregation equivalence", () => {
  it("computeCampaignMetricsFromCounts matches computeCampaignMetrics", () => {
    const groups = groupCounts(EVENTS, (event) => ({
      type: event.type as string,
      classification: event.classification ?? null,
    }));
    expect(computeCampaignMetricsFromCounts(groups)).toEqual(computeCampaignMetrics(EVENTS));
  });

  it("variantStatsFromCounts matches variantStats", () => {
    const groups = groupCounts(EVENTS, (event) => ({
      type: event.type as string,
      variant: event.variant ?? null,
    }));
    expect(variantStatsFromCounts(groups)).toEqual(variantStats(EVENTS));
  });

  it("both helpers handle the empty case", () => {
    expect(computeCampaignMetricsFromCounts([])).toEqual(computeCampaignMetrics([]));
    expect(variantStatsFromCounts([])).toEqual([]);
  });
});
