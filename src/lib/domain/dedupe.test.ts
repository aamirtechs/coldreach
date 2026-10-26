import { describe, expect, it } from "vitest";
import { dedupeImport, isValidEmail, normalizeEmail } from "./dedupe";

describe("normalizeEmail", () => {
  it("trims whitespace and lowercases", () => {
    expect(normalizeEmail("  Jane.Doe@Example.COM ")).toBe("jane.doe@example.com");
  });

  it("keeps plus tags by default", () => {
    expect(normalizeEmail("jane+news@example.com")).toBe("jane+news@example.com");
  });

  it("strips plus tags when asked", () => {
    expect(normalizeEmail("jane+news@example.com", { stripPlusTag: true })).toBe(
      "jane@example.com",
    );
  });
});

describe("isValidEmail", () => {
  it("accepts a normal address and rejects malformed ones", () => {
    expect(isValidEmail("a@b.co")).toBe(true);
    expect(isValidEmail("not-an-email")).toBe(false);
    expect(isValidEmail("missing@dot")).toBe(false);
    expect(isValidEmail("two@@example.com")).toBe(false);
  });
});

describe("dedupeImport", () => {
  it("keeps the first occurrence and reports later ones as duplicates", () => {
    const result = dedupeImport([
      { email: "Jane@Example.com", fields: { firstName: "Jane" } },
      { email: "jane@example.com", fields: { firstName: "Duplicate" } },
      { email: "john@example.com" },
    ]);
    expect(result.kept).toHaveLength(2);
    expect(result.kept[0].fields?.firstName).toBe("Jane");
    expect(result.duplicates).toHaveLength(1);
    expect(result.summary).toEqual({ total: 3, kept: 2, duplicates: 1, invalid: 0 });
  });

  it("separates invalid addresses instead of importing them", () => {
    const result = dedupeImport([
      { email: "fine@example.com" },
      { email: "broken-address" },
      { email: "" },
    ]);
    expect(result.kept).toHaveLength(1);
    expect(result.invalid).toHaveLength(2);
    expect(result.summary.invalid).toBe(2);
  });

  it("treats plus-tagged variants as duplicates when stripping is enabled", () => {
    const result = dedupeImport(
      [{ email: "jane+a@example.com" }, { email: "jane+b@example.com" }],
      { stripPlusTag: true },
    );
    expect(result.kept).toHaveLength(1);
    expect(result.duplicates).toHaveLength(1);
  });
});
