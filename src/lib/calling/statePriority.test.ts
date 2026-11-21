import { describe, expect, it } from "vitest";
import {
  BLOCKED_STATES,
  HELD_STATES,
  STATE_PRIORITY,
  compareCallLeads,
  isCallableState,
  sortCallLeads,
  stateRank,
  stateStatus,
} from "./statePriority";

describe("state priority data", () => {
  it("orders Georgia, Illinois, North Carolina, Ohio", () => {
    expect(STATE_PRIORITY.map((entry) => entry.state)).toEqual(["GA", "IL", "NC", "OH"]);
    expect(STATE_PRIORITY.map((entry) => entry.rank)).toEqual([1, 2, 3, 4]);
  });

  it("holds Texas and blocks the five legal risk states", () => {
    expect(Object.keys(HELD_STATES)).toEqual(["TX"]);
    expect(BLOCKED_STATES).toEqual(["FL", "OK", "MD", "WA", "CT"]);
  });

  it("classifies states case insensitively", () => {
    expect(stateStatus("ga")).toBe("PRIORITY");
    expect(stateStatus("TX")).toBe("HELD");
    expect(stateStatus("fl")).toBe("BLOCKED");
    expect(stateStatus("MI")).toBe("STANDARD");
    expect(stateStatus(null)).toBe("STANDARD");
    expect(isCallableState("GA")).toBe(true);
    expect(isCallableState("TX")).toBe(false);
    expect(isCallableState("FL")).toBe(false);
  });

  it("ranks held and blocked below standard states", () => {
    expect(stateRank("GA")).toBeLessThan(stateRank("OH"));
    expect(stateRank("OH")).toBeLessThan(stateRank("MI"));
    expect(stateRank("MI")).toBeLessThan(stateRank("TX"));
    expect(stateRank("TX")).toBeLessThan(stateRank("FL"));
  });
});

describe("compareCallLeads", () => {
  it("sorts Georgia first, then HOT before WARM, then score", () => {
    const leads = [
      { state: "FL", temperature: "HOT", leadScore: 99 },
      { state: "GA", temperature: "WARM", leadScore: 50 },
      { state: "GA", temperature: "HOT", leadScore: 60 },
      { state: "GA", temperature: "HOT", leadScore: 80 },
      { state: "IL", temperature: "HOT", leadScore: 95 },
      { state: "MI", temperature: "HOT", leadScore: 90 },
    ];
    const sorted = sortCallLeads(leads);
    expect(sorted.map((lead) => `${lead.state}:${lead.temperature}:${lead.leadScore}`)).toEqual([
      "GA:HOT:80",
      "GA:HOT:60",
      "GA:WARM:50",
      "IL:HOT:95",
      "MI:HOT:90",
      "FL:HOT:99",
    ]);
  });

  it("treats a missing score as lowest within its group", () => {
    expect(
      compareCallLeads(
        { state: "GA", temperature: "HOT", leadScore: null },
        { state: "GA", temperature: "HOT", leadScore: 41 },
      ),
    ).toBeGreaterThan(0);
  });
});
