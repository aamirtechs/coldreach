import { describe, expect, it } from "vitest";
import {
  CALLING_SERVICES,
  callingServicesByPriority,
  getCallingService,
  validateServiceCatalog,
} from "./services";

describe("calling service catalog", () => {
  it("is internally sound", () => {
    expect(validateServiceCatalog()).toEqual([]);
  });

  it("has unique slugs and priorities", () => {
    const slugs = CALLING_SERVICES.map((s) => s.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    const priorities = CALLING_SERVICES.map((s) => s.priority);
    expect(new Set(priorities).size).toBe(priorities.length);
  });

  it("gives every service signals, disqualifiers, pains, an offer and a do not say list", () => {
    for (const service of CALLING_SERVICES) {
      expect(service.hotSignals.length).toBeGreaterThan(0);
      expect(service.warmSignals.length).toBeGreaterThan(0);
      expect(service.disqualifiers.length).toBeGreaterThan(0);
      expect(service.corePains.length).toBeGreaterThan(0);
      expect(service.defaultOfferLine.length).toBeGreaterThan(0);
      expect(service.defaultDontSay.length).toBeGreaterThan(0);
    }
  });

  it("puts truck dispatching last and WordPress speed first", () => {
    const ordered = callingServicesByPriority();
    expect(ordered[0].slug).toBe("wordpress-speed");
    expect(ordered[ordered.length - 1].slug).toBe("truck-dispatching");
  });

  it("resolves services by slug", () => {
    expect(getCallingService("wordpress-bug-fix")?.name).toContain("Bug");
    expect(getCallingService("nope")).toBeNull();
    expect(getCallingService(null)).toBeNull();
  });

  it("contains no em dashes", () => {
    const all = JSON.stringify(CALLING_SERVICES);
    expect(all).not.toContain("—");
  });
});
