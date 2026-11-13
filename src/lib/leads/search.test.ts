import { describe, expect, it } from "vitest";
import { leadCompanyOf, leadFieldValue, leadMatchesSearch, leadNameOf } from "./search";

const lead = {
  email: "corporate@cacaoandcardamom.com",
  fields: { firstName: "Annie", lastName: "Rupani", company: "Cacao & Cardamom", country: "US" },
};

describe("leadMatchesSearch", () => {
  it("matches the email, case-insensitively and partially", () => {
    expect(leadMatchesSearch(lead, "CACAOANDCARDAMOM")).toBe(true);
    expect(leadMatchesSearch(lead, "corporate@cacao")).toBe(true);
  });

  it("matches first name and last name", () => {
    expect(leadMatchesSearch(lead, "annie")).toBe(true);
    expect(leadMatchesSearch(lead, "RUPANI")).toBe(true);
  });

  it("matches the full name spanning first and last", () => {
    expect(leadMatchesSearch(lead, "Annie Rupani")).toBe(true);
  });

  it("matches the company", () => {
    expect(leadMatchesSearch(lead, "cacao & cardamom")).toBe(true);
    expect(leadMatchesSearch(lead, "Cardamom")).toBe(true);
  });

  it("does not match unrelated text or other fields", () => {
    expect(leadMatchesSearch(lead, "globex")).toBe(false);
    expect(leadMatchesSearch(lead, "US")).toBe(false);
  });

  it("treats an empty query as a match", () => {
    expect(leadMatchesSearch(lead, "")).toBe(true);
    expect(leadMatchesSearch(lead, "   ")).toBe(true);
  });

  it("handles missing and malformed fields", () => {
    expect(leadMatchesSearch({ email: "a@b.com", fields: null }, "a@b")).toBe(true);
    expect(leadMatchesSearch({ email: "a@b.com", fields: null }, "annie")).toBe(false);
    expect(leadMatchesSearch({ email: "a@b.com", fields: "junk" }, "annie")).toBe(false);
    expect(leadMatchesSearch({ email: "a@b.com", fields: [1, 2] }, "annie")).toBe(false);
  });

  it("reads field keys case-insensitively", () => {
    const odd = { email: "x@y.com", fields: { Company: "Globex Inc", FirstName: "Jo" } };
    expect(leadMatchesSearch(odd, "globex")).toBe(true);
    expect(leadMatchesSearch(odd, "jo")).toBe(true);
  });

  it("matches a single name field when no first or last name exists", () => {
    const named = { email: "x@y.com", fields: { name: "Sam Carter" } };
    expect(leadMatchesSearch(named, "sam carter")).toBe(true);
    expect(leadNameOf(named.fields)).toBe("Sam Carter");
  });
});

describe("leadFieldValue, leadNameOf, leadCompanyOf", () => {
  it("extracts name and company", () => {
    expect(leadNameOf(lead.fields)).toBe("Annie Rupani");
    expect(leadCompanyOf(lead.fields)).toBe("Cacao & Cardamom");
  });

  it("returns null when absent", () => {
    expect(leadNameOf({})).toBeNull();
    expect(leadCompanyOf(null)).toBeNull();
    expect(leadFieldValue({ company: "  " }, "company")).toBeNull();
  });

  it("coerces numeric field values", () => {
    expect(leadFieldValue({ company: 42 }, "company")).toBe("42");
  });
});
