import { describe, expect, it } from "vitest";
import {
  callLeadFromBody,
  callLeadRenderFields,
  evidenceFromFields,
  stringListFromFields,
  verifyFromBody,
} from "./callLeadFields";

describe("callLeadFromBody", () => {
  it("builds a lead from a full body", () => {
    const result = callLeadFromBody({
      name: "Anna Handy",
      company: "Anna Handy Law Firm",
      phone: "(386) 248-3000",
      serviceSlug: "wordpress-speed",
      temperature: "hot",
      leadScore: 88,
      timezone: "America/New_York",
      hook: "Score 24 of 100.",
      signals: ["Score under 40"],
      dontSay: "Never promise 100.\nNever promise rankings.",
      evidence: [{ label: "Phone", url: "https://annahandylaw.com/", note: "Footer" }],
    });
    expect("lead" in result).toBe(true);
    if (!("lead" in result)) return;
    expect(result.lead.firstName).toBe("Anna");
    expect(result.lead.lastName).toBe("Handy");
    expect(result.lead.temperature).toBe("HOT");
    expect(result.lead.leadScore).toBe(88);
    expect(result.lead.fields.hook).toBe("Score 24 of 100.");
    expect(result.lead.fields.signals).toEqual(["Score under 40"]);
    expect(result.lead.fields.dontSay).toEqual([
      "Never promise 100.",
      "Never promise rankings.",
    ]);
    expect(result.lead.fields.evidence).toEqual([
      { label: "Phone", url: "https://annahandylaw.com/", note: "Footer" },
    ]);
  });

  it("requires a phone and a name or company", () => {
    expect("error" in callLeadFromBody({ name: "A B" })).toBe(true);
    expect("error" in callLeadFromBody({ phone: "123" })).toBe(true);
  });

  it("rejects an unknown service and a bad timezone", () => {
    expect(
      "error" in callLeadFromBody({ phone: "1", company: "X", serviceSlug: "nope" }),
    ).toBe(true);
    expect(
      "error" in callLeadFromBody({ phone: "1", company: "X", timezone: "Mars/Olympus" }),
    ).toBe(true);
  });

  it("defaults temperature to WARM and service to wordpress-speed", () => {
    const result = callLeadFromBody({ phone: "1", company: "X" });
    if (!("lead" in result)) throw new Error("expected a lead");
    expect(result.lead.temperature).toBe("WARM");
    expect(result.lead.serviceSlug).toBe("wordpress-speed");
  });
});

describe("verifyFromBody", () => {
  it("accepts the three statuses", () => {
    expect(verifyFromBody({ verifyStatus: "VERIFIED" })).toEqual({
      verifyStatus: "VERIFIED",
      verifyNote: null,
    });
    expect(verifyFromBody({ verifyStatus: "flagged", verifyNote: "Wrong number" })).toEqual({
      verifyStatus: "FLAGGED",
      verifyNote: "Wrong number",
    });
  });

  it("rejects anything else", () => {
    expect("error" in verifyFromBody({ verifyStatus: "MAYBE" })).toBe(true);
  });
});

describe("stored field readers", () => {
  it("folds columns into render fields", () => {
    const fields = callLeadRenderFields({
      firstName: "Leonard",
      lastName: "Desir",
      company: "The Desir Law Firm",
      phone: "954-848-2912",
      website: "https://www.thedesirlawfirm.com/",
      city: "Sunrise",
      state: "FL",
      timezone: "America/New_York",
      decisionMaker: "Leonard Desir",
      namePronunciation: "LEN-erd duh-ZEER",
      fields: { hook: "22 second load." },
    });
    expect(fields.firstName).toBe("Leonard");
    expect(fields.hook).toBe("22 second load.");
    expect(fields.timezone).toBe("America/New_York");
  });

  it("reads evidence and string lists defensively", () => {
    expect(evidenceFromFields({ evidence: [{ label: "Site", url: "https://x.com" }] })).toEqual([
      { label: "Site", url: "https://x.com", note: "" },
    ]);
    expect(evidenceFromFields(null)).toEqual([]);
    expect(stringListFromFields({ signals: ["a", "b"] }, "signals")).toEqual(["a", "b"]);
    expect(stringListFromFields({ dontSay: "one\ntwo" }, "dontSay")).toEqual(["one", "two"]);
  });
});

describe("lead scoring rubric", () => {
  it("derives HOT only when every gate passes", () => {
    const result = callLeadFromBody({
      phone: "1",
      company: "X",
      scoreFit: 25,
      scoreSignal: 40,
      scoreRecency: 15,
      scoreReachability: 12,
    });
    if (!("lead" in result)) throw new Error("expected a lead");
    expect(result.lead.temperature).toBe("HOT");
    expect(result.lead.leadScore).toBe(92);
  });

  it("demotes a high total that fails the signal gate to WARM", () => {
    const result = callLeadFromBody({
      phone: "1",
      company: "X",
      scoreFit: 25,
      scoreSignal: 20,
      scoreRecency: 15,
      scoreReachability: 20,
    });
    if (!("lead" in result)) throw new Error("expected a lead");
    expect(result.lead.leadScore).toBe(80);
    expect(result.lead.temperature).toBe("WARM");
  });

  it("refuses a lead under 40", () => {
    const result = callLeadFromBody({
      phone: "1",
      company: "X",
      scoreFit: 10,
      scoreSignal: 8,
      scoreRecency: 5,
      scoreReachability: 6,
    });
    expect("error" in result).toBe(true);
  });
});
