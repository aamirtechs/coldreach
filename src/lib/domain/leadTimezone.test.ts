import { describe, expect, it } from "vitest";
import {
  COUNTRY_TIMEZONES,
  US_STATE_TIMEZONES,
  countryCodeFor,
  isValidTimezone,
  resolveLeadTimezone,
} from "./leadTimezone";

describe("resolveLeadTimezone", () => {
  it("resolves full country names as they appear in real imports", () => {
    expect(resolveLeadTimezone({ country: "United States" })).toBe("America/Chicago");
    expect(resolveLeadTimezone({ country: "United Kingdom" })).toBe("Europe/London");
    expect(resolveLeadTimezone({ country: "Australia" })).toBe("Australia/Sydney");
    expect(resolveLeadTimezone({ country: "United Arab Emirates" })).toBe("Asia/Dubai");
    expect(resolveLeadTimezone({ country: "South Africa" })).toBe("Africa/Johannesburg");
  });

  it("resolves ISO codes and short forms", () => {
    expect(resolveLeadTimezone({ country: "US" })).toBe("America/Chicago");
    expect(resolveLeadTimezone({ country: "USA" })).toBe("America/Chicago");
    expect(resolveLeadTimezone({ country: "UK" })).toBe("Europe/London");
    expect(resolveLeadTimezone({ country: "GB" })).toBe("Europe/London");
    expect(resolveLeadTimezone({ country: "UAE" })).toBe("Asia/Dubai");
    expect(resolveLeadTimezone({ country: "U.S.A." })).toBe("America/Chicago");
  });

  it("prefers a US state over the national reference zone", () => {
    expect(resolveLeadTimezone({ country: "United States", state: "CA" })).toBe("America/Los_Angeles");
    expect(resolveLeadTimezone({ country: "US", state: "Texas" })).toBe("America/Chicago");
    expect(resolveLeadTimezone({ country: "USA", state: "New York" })).toBe("America/New_York");
    expect(resolveLeadTimezone({ country: "United States", state: "Florida" })).toBe("America/New_York");
  });

  it("ignores a state that does not belong to the lead's country", () => {
    expect(resolveLeadTimezone({ country: "United Kingdom", state: "Texas" })).toBe("Europe/London");
  });

  it("prefers an explicit, valid timezone field over everything", () => {
    expect(resolveLeadTimezone({ country: "United States", timezone: "America/Denver" })).toBe("America/Denver");
    expect(resolveLeadTimezone({ country: "United States", tz: "Pacific/Honolulu" })).toBe("Pacific/Honolulu");
  });

  it("falls through an invalid explicit timezone to the country", () => {
    expect(resolveLeadTimezone({ country: "Canada", timezone: "Not/AZone" })).toBe("America/Toronto");
  });

  it("returns null when nothing resolves, so callers keep the campaign zone", () => {
    expect(resolveLeadTimezone({})).toBeNull();
    expect(resolveLeadTimezone({ firstName: "Test" })).toBeNull();
    expect(resolveLeadTimezone({ country: "" })).toBeNull();
    expect(resolveLeadTimezone({ country: "Atlantis" })).toBeNull();
    expect(resolveLeadTimezone(null)).toBeNull();
    expect(resolveLeadTimezone(undefined)).toBeNull();
  });

  it("matches field names case-insensitively, as imports produce them", () => {
    expect(resolveLeadTimezone({ Country: "Canada" })).toBe("America/Toronto");
    expect(resolveLeadTimezone({ COUNTRY: "Germany" })).toBe("Europe/Berlin");
  });
});

describe("countryCodeFor", () => {
  it("maps names, codes and aliases to ISO codes", () => {
    expect(countryCodeFor("United States")).toBe("US");
    expect(countryCodeFor("uk")).toBe("GB");
    expect(countryCodeFor("England")).toBe("GB");
    expect(countryCodeFor("Czech Republic")).toBe("CZ");
    expect(countryCodeFor("Atlantis")).toBeNull();
  });
});

describe("isValidTimezone", () => {
  it("accepts real zones and rejects invented ones", () => {
    expect(isValidTimezone("America/New_York")).toBe(true);
    expect(isValidTimezone("Mars/Olympus")).toBe(false);
  });
});

describe("mapped zones are real IANA zones", () => {
  it("resolves Georgia and Armenia to their Asia zones", () => {
    // Regression: these two entries carried Europe/ prefixes until
    // 2026-11-04. Neither Europe/Tbilisi nor Europe/Yerevan exists,
    // and the invalid value crashed the dashboard render (and could
    // abort the sending tick) once a Georgian lead became due.
    expect(resolveLeadTimezone({ country: "Georgia" })).toBe("Asia/Tbilisi");
    expect(resolveLeadTimezone({ country: "GE" })).toBe("Asia/Tbilisi");
    expect(resolveLeadTimezone({ country: "Armenia" })).toBe("Asia/Yerevan");
    expect(resolveLeadTimezone({ country: "AM" })).toBe("Asia/Yerevan");
  });

  it("every country and US state map value passes Intl validation", () => {
    for (const [code, zone] of Object.entries(COUNTRY_TIMEZONES)) {
      expect(isValidTimezone(zone), `${code} -> ${zone}`).toBe(true);
    }
    for (const [code, zone] of Object.entries(US_STATE_TIMEZONES)) {
      expect(isValidTimezone(zone), `${code} -> ${zone}`).toBe(true);
    }
  });
});
