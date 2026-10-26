import { describe, expect, it } from "vitest";
import {
  pickVariant,
  pickWinner,
  twoProportionZTest,
  variantStats,
  type VariantEvent,
  type VariantStat,
} from "./abtest";

const CANDIDATES = [
  { label: "A", weight: 1 },
  { label: "B", weight: 1 },
];

describe("pickVariant", () => {
  it("is deterministic: the same enrollment and step always pick the same variant", () => {
    for (let i = 0; i < 50; i += 1) {
      const id = `enrollment-${i}`;
      expect(pickVariant(id, 0, CANDIDATES)).toBe(pickVariant(id, 0, CANDIDATES));
      expect(pickVariant(id, 2, CANDIDATES)).toBe(pickVariant(id, 2, CANDIDATES));
    }
  });

  it("returns A when there are no extra variants", () => {
    expect(pickVariant("enrollment-1", 0, [{ label: "A", weight: 1 }])).toBe("A");
    expect(pickVariant("enrollment-1", 0, [])).toBe("A");
  });

  it("splits roughly evenly between equal weights", () => {
    let bCount = 0;
    const total = 2000;
    for (let i = 0; i < total; i += 1) {
      if (pickVariant(`enroll-${i}`, 0, CANDIDATES) === "B") {
        bCount += 1;
      }
    }
    const share = bCount / total;
    expect(share).toBeGreaterThan(0.42);
    expect(share).toBeLessThan(0.58);
  });

  it("honours weights: a 3x weight gets roughly 3x the traffic", () => {
    let bCount = 0;
    const total = 4000;
    const weighted = [
      { label: "A", weight: 1 },
      { label: "B", weight: 3 },
    ];
    for (let i = 0; i < total; i += 1) {
      if (pickVariant(`enroll-${i}`, 1, weighted) === "B") {
        bCount += 1;
      }
    }
    const share = bCount / total;
    expect(share).toBeGreaterThan(0.68);
    expect(share).toBeLessThan(0.82);
  });

  it("ignores zero-weight candidates", () => {
    const picked = pickVariant("enrollment-x", 0, [
      { label: "A", weight: 1 },
      { label: "B", weight: 0 },
    ]);
    expect(picked).toBe("A");
  });
});

function stat(label: string, delivered: number, replied: number, sent = delivered): VariantStat {
  return {
    label,
    sent,
    delivered,
    replied,
    bounced: 0,
    replyRate: delivered > 0 ? replied / delivered : 0,
  };
}

describe("variantStats", () => {
  it("aggregates counts and reply rate per variant, reading null as A", () => {
    const events: VariantEvent[] = [
      { type: "SENT", variant: "A" },
      { type: "SENT", variant: null },
      { type: "DELIVERED", variant: "A" },
      { type: "REPLIED", variant: "A" },
      { type: "SENT", variant: "B" },
      { type: "DELIVERED", variant: "B" },
      { type: "DELIVERED", variant: "B" },
      { type: "BOUNCED", variant: "B" },
      { type: "OPENED", variant: "B" },
    ];
    const stats = variantStats(events);
    const a = stats.find((entry) => entry.label === "A");
    const b = stats.find((entry) => entry.label === "B");
    expect(a).toMatchObject({ sent: 2, delivered: 1, replied: 1, bounced: 0 });
    expect(a?.replyRate).toBe(1);
    expect(b).toMatchObject({ sent: 1, delivered: 2, replied: 0, bounced: 1 });
    expect(b?.replyRate).toBe(0);
  });

  it("returns an empty array for no events", () => {
    expect(variantStats([])).toEqual([]);
  });
});

describe("twoProportionZTest", () => {
  it("finds no difference for identical rates", () => {
    const result = twoProportionZTest(10, 100, 10, 100);
    expect(result.zScore).toBeCloseTo(0);
    expect(result.pValue).toBeCloseTo(1);
  });

  it("flags a large clear difference as significant", () => {
    const result = twoProportionZTest(30, 100, 10, 100);
    expect(result.zScore).toBeGreaterThan(1.96);
    expect(result.pValue).toBeLessThan(0.05);
  });
});

describe("pickWinner", () => {
  it("returns null when samples are below the minimum, however lopsided", () => {
    const stats = [stat("A", 10, 0), stat("B", 10, 9)];
    expect(pickWinner(stats, 30)).toBeNull();
  });

  it("returns null when the difference is within noise at full sample", () => {
    const stats = [stat("A", 200, 22), stat("B", 200, 20)];
    expect(pickWinner(stats, 30)).toBeNull();
  });

  it("returns null with a single variant", () => {
    expect(pickWinner([stat("A", 500, 100)], 30)).toBeNull();
  });

  it("declares the winner on a large clear difference", () => {
    const stats = [stat("A", 300, 30), stat("B", 300, 90)];
    const winner = pickWinner(stats, 30);
    expect(winner?.label).toBe("B");
    expect(winner?.zScore).toBeGreaterThan(1.96);
    expect(winner?.pValue).toBeLessThan(0.05);
  });

  it("requires the leader to beat every other variant", () => {
    // B beats A clearly, C ties B: no winner may be declared.
    const stats = [stat("A", 300, 30), stat("B", 300, 90), stat("C", 300, 88)];
    expect(pickWinner(stats, 30)).toBeNull();
  });
});
