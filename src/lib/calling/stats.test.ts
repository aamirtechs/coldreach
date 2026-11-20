import { describe, expect, it } from "vitest";
import { callbacksDue, summarizeCallLogs, type CallLogLike } from "./stats";
import { CALL_DISPOSITIONS, isCallDisposition } from "./dispositions";

const NOW = new Date("2026-11-20T15:00:00");

function log(partial: Partial<CallLogLike>): CallLogLike {
  return {
    leadId: "lead-1",
    disposition: "TALKED",
    calledAt: new Date("2026-11-20T10:00:00"),
    followUpAt: null,
    ...partial,
  };
}

describe("call dispositions", () => {
  it("exposes the eight panel outcomes in order", () => {
    expect(CALL_DISPOSITIONS.map((d) => d.label)).toEqual([
      "No answer",
      "Voicemail",
      "Gatekeeper",
      "Talked",
      "Interested",
      "Callback",
      "Not interested",
      "Do not call",
    ]);
  });

  it("accepts only known disposition values", () => {
    expect(isCallDisposition("INTERESTED")).toBe(true);
    expect(isCallDisposition("interested")).toBe(false);
    expect(isCallDisposition("")).toBe(false);
    expect(isCallDisposition(undefined)).toBe(false);
  });
});

describe("summarizeCallLogs", () => {
  it("counts today, conversations, interest and booked callbacks", () => {
    const stats = summarizeCallLogs(
      [
        log({ disposition: "TALKED" }),
        log({ disposition: "INTERESTED" }),
        log({ disposition: "VOICEMAIL" }),
        log({ disposition: "CALLBACK", followUpAt: new Date("2026-11-21T10:00:00") }),
        log({ disposition: "NO_ANSWER", calledAt: new Date("2026-11-19T10:00:00") }),
        // A callback disposition with no follow up time is not a booking.
        log({ disposition: "CALLBACK", followUpAt: null, calledAt: new Date("2026-11-19T11:00:00") }),
      ],
      NOW,
    );
    expect(stats).toEqual({
      callsToday: 4,
      totalCalls: 6,
      talked: 4,
      interested: 1,
      callbacksBooked: 1,
    });
  });

  it("handles an empty history", () => {
    expect(summarizeCallLogs([], NOW)).toEqual({
      callsToday: 0,
      totalCalls: 0,
      talked: 0,
      interested: 0,
      callbacksBooked: 0,
    });
  });
});

describe("callbacksDue", () => {
  it("keeps only the latest follow up per lead and sorts soonest first", () => {
    const due = callbacksDue(
      [
        log({ leadId: "a", disposition: "CALLBACK", calledAt: new Date("2026-11-18T09:00:00"), followUpAt: new Date("2026-11-25T09:00:00") }),
        log({ leadId: "a", disposition: "CALLBACK", calledAt: new Date("2026-11-19T09:00:00"), followUpAt: new Date("2026-11-22T09:00:00") }),
        log({ leadId: "b", disposition: "CALLBACK", calledAt: new Date("2026-11-19T10:00:00"), followUpAt: new Date("2026-11-20T09:00:00") }),
        log({ leadId: "c", disposition: "TALKED", followUpAt: new Date("2026-11-20T09:00:00") }),
        log({ leadId: null, disposition: "CALLBACK", followUpAt: new Date("2026-11-20T09:00:00") }),
      ],
      NOW,
    );
    expect(due.map((entry) => entry.log.leadId)).toEqual(["b", "c", "a"]);
    expect(due[0].due).toBe(true);
    expect(due[1].due).toBe(true);
    expect(due[2].due).toBe(false);
    expect(due[2].followUpAt).toEqual(new Date("2026-11-22T09:00:00"));
  });

  it("surfaces an interested log whose follow up is a booked walkthrough", () => {
    const due = callbacksDue(
      [
        log({ leadId: "w", disposition: "INTERESTED", calledAt: new Date("2026-11-20T10:00:00"), followUpAt: new Date("2026-11-23T10:00:00") }),
      ],
      NOW,
    );
    expect(due).toHaveLength(1);
    expect(due[0].log.disposition).toBe("INTERESTED");
    expect(due[0].followUpAt).toEqual(new Date("2026-11-23T10:00:00"));
    expect(due[0].due).toBe(false);
  });

  it("ignores logs with no follow up time, whatever the disposition", () => {
    const due = callbacksDue(
      [
        log({ leadId: "a", disposition: "INTERESTED", followUpAt: null }),
        log({ leadId: "b", disposition: "CALLBACK", followUpAt: null }),
        log({ leadId: "c", disposition: "TALKED", followUpAt: null }),
      ],
      NOW,
    );
    expect(due).toEqual([]);
  });

  it("lets a newer log with a follow up supersede an older booking for the same lead", () => {
    const due = callbacksDue(
      [
        log({ leadId: "a", disposition: "CALLBACK", calledAt: new Date("2026-11-18T09:00:00"), followUpAt: new Date("2026-11-21T09:00:00") }),
        log({ leadId: "a", disposition: "INTERESTED", calledAt: new Date("2026-11-19T09:00:00"), followUpAt: new Date("2026-11-24T09:00:00") }),
      ],
      NOW,
    );
    expect(due).toHaveLength(1);
    expect(due[0].log.disposition).toBe("INTERESTED");
    expect(due[0].followUpAt).toEqual(new Date("2026-11-24T09:00:00"));
  });
});
