import { describe, expect, it } from "vitest";
import { computeAccountHealth } from "./accountHealth";

const base = { status: "CONNECTED", lastError: null, sent7d: 0, bounced7d: 0 };

describe("computeAccountHealth", () => {
  it("is healthy for a connected account with no errors and no bounces", () => {
    const health = computeAccountHealth({ ...base, sent7d: 100, bounced7d: 1 });
    expect(health.state).toBe("healthy");
    expect(health.reasons).toEqual([]);
    expect(health.bounceCritical).toBe(false);
  });

  it("stays healthy at the production-like bounce level (3 bounces in 456 sends)", () => {
    const health = computeAccountHealth({ ...base, sent7d: 456, bounced7d: 3 });
    expect(health.state).toBe("healthy");
  });

  it("is critical when the bounce rate crosses 8% over at least 30 sends", () => {
    const health = computeAccountHealth({ ...base, sent7d: 50, bounced7d: 4 });
    expect(health.state).toBe("critical");
    expect(health.bounceCritical).toBe(true);
    expect(health.reasons.join(" ")).toContain("8%");
  });

  it("does not trip the critical rule below the 30 send floor", () => {
    const health = computeAccountHealth({ ...base, sent7d: 10, bounced7d: 3 });
    expect(health.state).toBe("healthy");
    expect(health.bounceCritical).toBe(false);
  });

  it("is attention when the bounce rate crosses 4% over at least 20 sends", () => {
    const health = computeAccountHealth({ ...base, sent7d: 100, bounced7d: 5 });
    expect(health.state).toBe("attention");
    expect(health.bounceCritical).toBe(false);
  });

  it("does not trip the attention rule below the 20 send floor", () => {
    const health = computeAccountHealth({ ...base, sent7d: 12, bounced7d: 2 });
    expect(health.state).toBe("healthy");
  });

  it("is critical when the account status is ERROR, regardless of bounces", () => {
    const health = computeAccountHealth({ ...base, status: "ERROR", sent7d: 5, bounced7d: 0 });
    expect(health.state).toBe("critical");
    expect(health.bounceCritical).toBe(false);
  });

  it("is attention when a reply sync error is stored on the account", () => {
    const health = computeAccountHealth({
      ...base,
      lastError: "Reply sync failed: Failed to establish connection in required time",
      sent7d: 50,
      bounced7d: 0,
    });
    expect(health.state).toBe("attention");
    expect(health.reasons.join(" ")).toContain("Reply sync");
  });

  it("ignores a stored error that is not a reply sync failure", () => {
    const health = computeAccountHealth({
      ...base,
      lastError: "SMTP authentication failed",
      sent7d: 50,
      bounced7d: 0,
    });
    expect(health.state).toBe("healthy");
  });

  it("is attention when paused or disconnected", () => {
    expect(computeAccountHealth({ ...base, status: "PAUSED" }).state).toBe("attention");
    expect(computeAccountHealth({ ...base, status: "DISCONNECTED" }).state).toBe("attention");
  });

  it("keeps critical over attention when both kinds of reasons exist", () => {
    const health = computeAccountHealth({
      status: "CONNECTED",
      lastError: "Reply sync failed: timeout",
      sent7d: 40,
      bounced7d: 4,
    });
    expect(health.state).toBe("critical");
    expect(health.reasons.length).toBeGreaterThanOrEqual(2);
  });

  it("reports a zero bounce rate when nothing was sent", () => {
    const health = computeAccountHealth({ ...base, sent7d: 0, bounced7d: 0 });
    expect(health.bounceRate).toBe(0);
    expect(health.state).toBe("healthy");
  });
});
