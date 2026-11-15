import { describe, expect, it } from "vitest";
import { buildManualLeadBody, buildManualLeadFields, parseManualTags } from "./manualAdd";

const base = {
  email: "  jane@acme.example ",
  firstName: " Jane ",
  lastName: "",
  company: "Acme Inc",
  icebreaker: "",
  customFields: [],
  tagsText: "",
};

describe("buildManualLeadFields", () => {
  it("keeps trimmed standard fields and drops empties", () => {
    expect(buildManualLeadFields(base)).toEqual({ firstName: "Jane", company: "Acme Inc" });
  });

  it("stores the hook line under the icebreaker key the tokens read", () => {
    const fields = buildManualLeadFields({
      ...base,
      icebreaker: " Saw you just acquired Anderro, congrats. ",
    });
    expect(fields.icebreaker).toBe("Saw you just acquired Anderro, congrats.");
  });

  it("adds custom fields and skips blank rows", () => {
    const fields = buildManualLeadFields({
      ...base,
      customFields: [
        { key: "website", value: "https://anderro.com" },
        { key: "title", value: "Founder" },
        { key: "", value: "ignored" },
        { key: "city", value: " " },
      ],
    });
    expect(fields.website).toBe("https://anderro.com");
    expect(fields.title).toBe("Founder");
    expect(fields.city).toBeUndefined();
  });

  it("never lets a custom row override a standard field or the email", () => {
    const fields = buildManualLeadFields({
      ...base,
      customFields: [
        { key: "Company", value: "Override Co" },
        { key: "ICEBREAKER", value: "Override line" },
        { key: "email", value: "other@example.com" },
      ],
    });
    expect(fields.company).toBe("Acme Inc");
    expect(fields.icebreaker).toBeUndefined();
    expect(fields.email).toBeUndefined();
  });

  it("lets the last duplicate custom key win", () => {
    const fields = buildManualLeadFields({
      ...base,
      customFields: [
        { key: "source", value: "Facebook" },
        { key: "source", value: "Website" },
      ],
    });
    expect(fields.source).toBe("Website");
  });
});

describe("parseManualTags", () => {
  it("splits, trims, and drops empties", () => {
    expect(parseManualTags(" vip, saas ,, founder ")).toEqual(["vip", "saas", "founder"]);
    expect(parseManualTags("")).toEqual([]);
  });
});

describe("buildManualLeadBody", () => {
  it("assembles the POST /api/leads body", () => {
    const body = buildManualLeadBody(
      { ...base, icebreaker: "Hook line", tagsText: "vip, saas" },
      "list-1",
    );
    expect(body).toEqual({
      email: "jane@acme.example",
      listId: "list-1",
      fields: { firstName: "Jane", company: "Acme Inc", icebreaker: "Hook line" },
      tags: ["vip", "saas"],
    });
  });
});
