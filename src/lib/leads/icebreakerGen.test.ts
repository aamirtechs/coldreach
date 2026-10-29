import { describe, expect, it } from "vitest";
import {
  buildIcebreakerContext,
  cleanIcebreaker,
  existingIcebreaker,
  extractReadableText,
  websiteUrlForLead,
} from "./icebreakerGen";

describe("websiteUrlForLead", () => {
  it("reads the website field", () => {
    expect(websiteUrlForLead({ website: "https://www.alphatransitllc.com/" })).toBe(
      "https://www.alphatransitllc.com/",
    );
  });

  it("falls back to the source field", () => {
    expect(websiteUrlForLead({ source: "https://example.com/contact" })).toBe(
      "https://example.com/contact",
    );
  });

  it("returns null for missing or non-web values", () => {
    expect(websiteUrlForLead({ company: "Acme" })).toBeNull();
    expect(websiteUrlForLead({ website: "not a url" })).toBeNull();
    expect(websiteUrlForLead({ website: "ftp://example.com" })).toBeNull();
  });
});

describe("extractReadableText", () => {
  it("strips scripts, styles, and tags and collapses whitespace", () => {
    const html =
      "<html><head><style>.a{color:red}</style><script>var x=1;</script></head>" +
      "<body><h1>Alpha   Transit</h1><p>Dispatch &amp; invoicing&nbsp;by hand.</p></body></html>";
    expect(extractReadableText(html)).toBe("Alpha Transit Dispatch & invoicing by hand.");
  });

  it("caps the excerpt", () => {
    const html = `<p>${"word ".repeat(2000)}</p>`;
    expect(extractReadableText(html, 100).length).toBe(100);
  });
});

describe("buildIcebreakerContext", () => {
  it("passes string fields through, skips the old icebreaker, adds the excerpt", () => {
    const context = buildIcebreakerContext(
      {
        email: "dispatch@alpha.example",
        fields: {
          company: "Alpha Transit LLC",
          fit_note: "Broker packets completed by hand",
          icebreaker: "stale",
          count: 3,
        },
      },
      "Alpha Transit home page text",
    );
    expect(context.leadEmail).toBe("dispatch@alpha.example");
    expect(context.leadFields.company).toBe("Alpha Transit LLC");
    expect(context.leadFields.fit_note).toBe("Broker packets completed by hand");
    expect(context.leadFields.icebreaker).toBeUndefined();
    expect(context.leadFields.websiteExcerpt).toBe("Alpha Transit home page text");
  });

  it("omits the excerpt when the fetch produced nothing", () => {
    const context = buildIcebreakerContext({ email: "a@b.example", fields: {} }, "  ");
    expect(context.leadFields.websiteExcerpt).toBeUndefined();
  });
});

describe("cleanIcebreaker", () => {
  it("strips surrounding quotes and collapses to one line", () => {
    expect(cleanIcebreaker('"Broker packets at Alpha\nare done by hand."')).toBe(
      "Broker packets at Alpha are done by hand.",
    );
  });

  it("removes an Icebreaker label", () => {
    expect(cleanIcebreaker("Icebreaker: Your kits are listed twice.")).toBe(
      "Your kits are listed twice.",
    );
  });

  it("caps very long output at a sentence boundary", () => {
    const long = `${"A specific observation about the business. ".repeat(10)}Trailing fragment here`;
    const cleaned = cleanIcebreaker(long);
    expect(cleaned.length).toBeLessThanOrEqual(300);
    expect(cleaned.endsWith(".")).toBe(true);
  });

  it("returns empty for empty input", () => {
    expect(cleanIcebreaker("   ")).toBe("");
  });
});

describe("existingIcebreaker", () => {
  it("reads the stored value and treats blanks as missing", () => {
    expect(existingIcebreaker({ icebreaker: "A line." })).toBe("A line.");
    expect(existingIcebreaker({ icebreaker: "  " })).toBe("");
    expect(existingIcebreaker({})).toBe("");
  });
});
