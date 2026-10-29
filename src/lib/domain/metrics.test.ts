import { describe, expect, it } from "vitest";
import { computeCampaignMetrics, type MetricEvent } from "./metrics";

function events(...list: MetricEvent[]): MetricEvent[] {
  return list;
}

function repeat(type: MetricEvent["type"], count: number): MetricEvent[] {
  return Array.from({ length: count }, () => ({ type }));
}

describe("computeCampaignMetrics", () => {
  it("counts events and derives rates on the documented denominators", () => {
    const metrics = computeCampaignMetrics([
      ...repeat("SENT", 10),
      ...repeat("DELIVERED", 9),
      ...repeat("BOUNCED", 1),
      { type: "REPLIED", classification: "POSITIVE" },
      { type: "REPLIED", classification: "positive" },
      { type: "REPLIED", classification: "NEGATIVE" },
      ...repeat("UNSUBSCRIBED", 1),
      ...repeat("COMPLAINED", 1),
      ...repeat("OPENED", 2),
      ...repeat("CLICKED", 1),
    ]);

    expect(metrics.sent).toBe(10);
    expect(metrics.delivered).toBe(9);
    expect(metrics.bounced).toBe(1);
    expect(metrics.replies).toBe(3);
    expect(metrics.positiveReplies).toBe(2);
    expect(metrics.unsubscribes).toBe(1);
    expect(metrics.complaints).toBe(1);
    expect(metrics.clicks).toBe(1);
    expect(metrics.opens.count).toBe(2);
    expect(metrics.opens.reliable).toBe(false);

    expect(metrics.rates.deliveryRate).toBeCloseTo(0.9);
    expect(metrics.rates.bounceRate).toBeCloseTo(0.1);
    expect(metrics.rates.replyRate).toBeCloseTo(3 / 9);
    expect(metrics.rates.positiveReplyRate).toBeCloseTo(2 / 9);
    expect(metrics.rates.unsubscribeRate).toBeCloseTo(1 / 9);
    expect(metrics.rates.complaintRate).toBeCloseTo(1 / 9);
  });

  it("counts clicks and derives clickRate on delivered volume", () => {
    const metrics = computeCampaignMetrics([
      ...repeat("SENT", 10),
      ...repeat("DELIVERED", 8),
      ...repeat("CLICKED", 2),
    ]);

    expect(metrics.clicks).toBe(2);
    expect(metrics.rates.clickRate).toBeCloseTo(2 / 8);
  });

  it("keeps AUTOMATED replies out of the human reply count", () => {
    const metrics = computeCampaignMetrics([
      ...repeat("SENT", 10),
      ...repeat("DELIVERED", 10),
      { type: "REPLIED", classification: "POSITIVE" },
      { type: "REPLIED", classification: "NEUTRAL" },
      { type: "REPLIED", classification: "AUTOMATED" },
      { type: "REPLIED", classification: "AUTOMATED" },
    ]);
    expect(metrics.replies).toBe(2);
    expect(metrics.automatedReplies).toBe(2);
    expect(metrics.rates.replyRate).toBeCloseTo(2 / 10);
  });

  it("returns zeros for an empty event set", () => {
    const metrics = computeCampaignMetrics(events());
    expect(metrics.sent).toBe(0);
    expect(metrics.rates.deliveryRate).toBe(0);
    expect(metrics.rates.replyRate).toBe(0);
  });

  it("never divides by zero when nothing was delivered", () => {
    const metrics = computeCampaignMetrics([
      { type: "REPLIED", classification: "POSITIVE" },
      { type: "UNSUBSCRIBED" },
    ]);
    expect(metrics.replies).toBe(1);
    expect(metrics.rates.replyRate).toBe(0);
    expect(metrics.rates.unsubscribeRate).toBe(0);
  });
});
