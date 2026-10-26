import { describe, expect, it } from "vitest";
import { findUnknownTokens, listTokens, renderTemplate } from "./personalize";

describe("renderTemplate", () => {
  it("substitutes known fields", () => {
    expect(
      renderTemplate("Hi {{firstName}}, saw your work at {{company}}.", {
        firstName: "Jane",
        company: "Acme",
      }),
    ).toBe("Hi Jane, saw your work at Acme.");
  });

  it("tolerates whitespace inside tokens", () => {
    expect(renderTemplate("Hi {{ firstName }}", { firstName: "Jane" })).toBe("Hi Jane");
  });

  it("uses the fallback when the field is missing or empty", () => {
    expect(renderTemplate("Hi {{firstName|there}}", {})).toBe("Hi there");
    expect(renderTemplate("Hi {{firstName|there}}", { firstName: "  " })).toBe("Hi there");
  });

  it("prefers the real value over the fallback", () => {
    expect(renderTemplate("Hi {{firstName|there}}", { firstName: "Jane" })).toBe("Hi Jane");
  });

  it("leaves unknown tokens without a fallback untouched", () => {
    expect(renderTemplate("Hi {{nickname}}", {})).toBe("Hi {{nickname}}");
  });

  it("stringifies numeric fields", () => {
    expect(renderTemplate("You have {{seats}} seats", { seats: 12 })).toBe("You have 12 seats");
  });
});

describe("findUnknownTokens", () => {
  it("reports tokens with neither a value nor a fallback", () => {
    expect(
      findUnknownTokens("Hi {{firstName}}, from {{city|your area}} via {{referrer}}", {
        firstName: "Jane",
      }),
    ).toEqual(["referrer"]);
  });

  it("returns an empty list when everything resolves", () => {
    expect(findUnknownTokens("Hi {{firstName|there}}", {})).toEqual([]);
  });
});

describe("listTokens", () => {
  it("lists distinct token names", () => {
    expect(listTokens("{{a}} {{b|x}} {{a}}").sort()).toEqual(["a", "b"]);
  });
});
