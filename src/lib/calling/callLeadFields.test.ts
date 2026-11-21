import { describe, expect, it } from "vitest";
import {
  callLeadFromBody,
  callLeadRenderFields,
  evidenceFromFields,
  saturdayInfoFromFields,
  saturdayOpenValue,
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

describe("Saturday fields", () => {
  it("keeps hours and the best window for a Saturday open lead", () => {
    const result = callLeadFromBody({
      phone: "1",
      company: "Open Saturdays LLC",
      saturdayOpen: true,
      saturdayHours: "8:00 AM to 2:00 PM",
      saturdayBestWindow: "Sat 9:00 to 11:00 AM",
    });
    if (!("lead" in result)) throw new Error("expected a lead");
    expect(result.lead.fields.saturdayOpen).toBe(true);
    expect(result.lead.fields.saturdayHours).toBe("8:00 AM to 2:00 PM");
    expect(result.lead.fields.saturdayBestWindow).toBe("Sat 9:00 to 11:00 AM");
    expect(saturdayInfoFromFields(result.lead.fields)).toEqual({
      open: true,
      hours: "8:00 AM to 2:00 PM",
      bestWindow: "Sat 9:00 to 11:00 AM",
    });
  });

  it("forces hours and window to null for a closed lead, even when supplied", () => {
    const result = callLeadFromBody({
      phone: "1",
      company: "Closed Saturdays LLC",
      saturdayOpen: false,
      saturdayHours: "8:00 AM to 2:00 PM",
      saturdayBestWindow: "Sat 9:00 to 11:00 AM",
    });
    if (!("lead" in result)) throw new Error("expected a lead");
    expect(result.lead.fields.saturdayOpen).toBe(false);
    expect(result.lead.fields.saturdayHours).toBeNull();
    expect(result.lead.fields.saturdayBestWindow).toBeNull();
    expect(saturdayInfoFromFields(result.lead.fields)).toEqual({
      open: false,
      hours: null,
      bestWindow: null,
    });
  });

  it("parses the loose string forms the forms and CSV import send", () => {
    expect(saturdayOpenValue("Open")).toBe(true);
    expect(saturdayOpenValue("yes")).toBe(true);
    expect(saturdayOpenValue("Closed")).toBe(false);
    expect(saturdayOpenValue("no")).toBe(false);
    expect(saturdayOpenValue("")).toBeNull();
    expect(saturdayOpenValue(undefined)).toBeNull();
    const result = callLeadFromBody({
      phone: "1",
      company: "String Flags LLC",
      saturdayOpen: "Closed",
      saturdayHours: "9 to 5",
    });
    if (!("lead" in result)) throw new Error("expected a lead");
    expect(result.lead.fields.saturdayOpen).toBe(false);
    expect(result.lead.fields.saturdayHours).toBeNull();
  });

  it("leaves Saturday unknown when the body says nothing about it", () => {
    const result = callLeadFromBody({ phone: "1", company: "Unknown Saturdays LLC" });
    if (!("lead" in result)) throw new Error("expected a lead");
    expect("saturdayOpen" in result.lead.fields).toBe(false);
    expect(saturdayInfoFromFields(result.lead.fields)).toEqual({
      open: null,
      hours: null,
      bestWindow: null,
    });
    expect(saturdayInfoFromFields(null)).toEqual({ open: null, hours: null, bestWindow: null });
  });

  it("never reports hours or a window off a stored closed lead", () => {
    expect(
      saturdayInfoFromFields({
        saturdayOpen: false,
        saturdayHours: "8:00 AM to 2:00 PM",
        saturdayBestWindow: "Sat 9:00 to 11:00 AM",
      }),
    ).toEqual({ open: false, hours: null, bestWindow: null });
  });
});

describe("hook accuracy rule", () => {
  it("rejects a hook with no evidence entry", () => {
    const result = callLeadFromBody({
      phone: "1",
      company: "Unbacked Hook LLC",
      hook: "Your site still shows the default tagline.",
    });
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toBe(
        "A hook needs at least one evidence link captured at research time",
      );
    }
  });

  it("rejects an icebreaker only hook with no evidence entry", () => {
    const result = callLeadFromBody({
      phone: "1",
      company: "Unbacked Icebreaker LLC",
      icebreaker: "Saw your checkout is broken.",
    });
    expect("error" in result).toBe(true);
  });

  it("accepts a hook backed by at least one evidence entry", () => {
    const result = callLeadFromBody({
      phone: "1",
      company: "Backed Hook LLC",
      hook: "Your contact page 404s.",
      evidence: [{ label: "Contact page", url: "https://example.com/contact", note: "404 checked today" }],
    });
    expect("lead" in result).toBe(true);
  });

  it("accepts a lead with no hook and no evidence", () => {
    const result = callLeadFromBody({ phone: "1", company: "Plain LLC" });
    expect("lead" in result).toBe(true);
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
