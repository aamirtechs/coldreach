import { describe, expect, it } from "vitest";
import { renderScriptTemplate, scriptValuesForLead } from "./renderScript";

describe("renderScriptTemplate", () => {
  it("fills placeholders from the lead fields", () => {
    const rendered = renderScriptTemplate(
      "Hi {{firstName}}, {{company}} scored {{mobileScore}} out of 100 and took {{lcp}} seconds.",
      {
        fields: { firstName: "Anna", company: "Anna Handy Law Firm", mobileScore: "24", lcp: "15.9" },
        email: "anna@example.com",
      },
    );
    expect(rendered).toBe(
      "Hi Anna, Anna Handy Law Firm scored 24 out of 100 and took 15.9 seconds.",
    );
  });

  it("matches field keys case-insensitively, as CSV imports arrive mixed", () => {
    const rendered = renderScriptTemplate("Call {{Phone}} for {{COMPANY}}", {
      fields: { phone: "+1 555 010 2030", Company: "Acme Inc" },
    });
    expect(rendered).toBe("Call +1 555 010 2030 for Acme Inc");
  });

  it("renders a known placeholder with no value as empty, never as a raw token", () => {
    const rendered = renderScriptTemplate("Score: {{mobileScore}}.", { fields: {} });
    expect(rendered).toBe("Score: .");
  });

  it("leaves unknown tokens untouched so free text survives", () => {
    const rendered = renderScriptTemplate("Keep {{customNote}} and {{firstName}}", {
      fields: { firstName: "Jane" },
    });
    expect(rendered).toBe("Keep {{customNote}} and Jane");
  });

  it("fills the email placeholder from the lead email column", () => {
    const rendered = renderScriptTemplate("Send it to {{email}}", {
      fields: {},
      email: "owner@shop.example",
    });
    expect(rendered).toBe("Send it to owner@shop.example");
  });

  it("tolerates a null fields value", () => {
    expect(renderScriptTemplate("Hi {{firstName}}", { fields: null })).toBe("Hi ");
    expect(scriptValuesForLead({ fields: null, email: null })).toEqual({});
  });
});
