import { describe, expect, it } from "vitest";
import { renderSpintax } from "./spintax";

describe("renderSpintax", () => {
  it("returns text without spintax unchanged", () => {
    expect(renderSpintax("Hello Jane, saw your work at Acme.", "seed-1")).toBe(
      "Hello Jane, saw your work at Acme.",
    );
    expect(renderSpintax("", "seed-1")).toBe("");
  });

  it("returns text with lone braces unchanged", () => {
    expect(renderSpintax("A lone } brace and an opening { one", "seed-1")).toBe(
      "A lone } brace and an opening { one",
    );
    expect(renderSpintax("Braces like {this} are not spintax", "seed-1")).toBe(
      "Braces like {this} are not spintax",
    );
  });

  it("picks one of the options for a single group", () => {
    const result = renderSpintax("{Hi|Hello|Hey} Jane,", "seed-1");
    expect(["Hi Jane,", "Hello Jane,", "Hey Jane,"]).toContain(result);
    expect(result).not.toContain("{");
    expect(result).not.toContain("}");
    expect(result).not.toContain("|");
  });

  it("is deterministic for the same seed and text", () => {
    const text = "{Hi|Hello|Hey}, {welcome|thanks} for {joining|stopping by}.";
    const first = renderSpintax(text, "campaign-42-lead-7");
    for (let i = 0; i < 5; i++) {
      expect(renderSpintax(text, "campaign-42-lead-7")).toBe(first);
    }
  });

  it("varies across seeds for a three option group", () => {
    const outputs = new Set<string>();
    for (let i = 0; i < 20; i++) {
      outputs.add(renderSpintax("{red|green|blue}", `seed-${i}`));
    }
    expect(outputs.size).toBeGreaterThanOrEqual(2);
    for (const output of outputs) {
      expect(["red", "green", "blue"]).toContain(output);
    }
  });

  it("resolves nested groups fully, leaving no braces behind", () => {
    const result = renderSpintax("Say {hello {there|friend}|hi} now", "seed-3");
    expect(["Say hello there now", "Say hello friend now", "Say hi now"]).toContain(result);
    expect(result).not.toContain("{");
    expect(result).not.toContain("}");
  });

  it("returns unbalanced input unchanged", () => {
    expect(renderSpintax("Hello {Hi|Hello", "seed-1")).toBe("Hello {Hi|Hello");
    expect(renderSpintax("Hello } there", "seed-1")).toBe("Hello } there");
  });

  it("leaves a group with no pipe as literal text", () => {
    expect(renderSpintax("Keep {this} and pick {that|those}", "seed-1")).toMatch(/^Keep \{this\} and pick (that|those)$/);
  });

  it("resolves multiple groups in one string", () => {
    const result = renderSpintax("{Hi|Hello}, {welcome|thanks} for {joining|stopping by}.", "seed-9");
    expect(result).not.toContain("{");
    expect(result).not.toContain("}");
    expect(result).not.toContain("|");
    expect(result).toMatch(/^(Hi|Hello), (welcome|thanks) for (joining|stopping by)\.$/);
  });

  it("keeps surrounding text and option spacing as written", () => {
    const result = renderSpintax("Start {one option| another option} end", "seed-2");
    expect(["Start one option end", "Start  another option end"]).toContain(result);
  });
});
