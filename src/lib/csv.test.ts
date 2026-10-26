import { describe, expect, it } from "vitest";
import { parseCsv, toCsv } from "./csv";

describe("parseCsv", () => {
  it("parses a simple file into headers and rows", () => {
    const parsed = parseCsv("email,firstName\njane@example.com,Jane\n");
    expect(parsed.headers).toEqual(["email", "firstName"]);
    expect(parsed.rows).toEqual([{ email: "jane@example.com", firstName: "Jane" }]);
  });

  it("handles quoted fields with commas, quotes, and newlines", () => {
    const parsed = parseCsv('email,note\r\n"a@example.com","said ""hi"", then\nleft"\r\n');
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].note).toBe('said "hi", then\nleft');
  });

  it("skips blank lines and tolerates a BOM", () => {
    const parsed = parseCsv("\uFEFFemail\n\na@example.com\n\n");
    expect(parsed.rows).toEqual([{ email: "a@example.com" }]);
  });
});

describe("toCsv", () => {
  it("escapes values that need quoting and round-trips", () => {
    const csv = toCsv(["email", "reason"], [{ email: "a@example.com", reason: 'Bad, "quoted"' }]);
    const parsed = parseCsv(csv);
    expect(parsed.rows[0].reason).toBe('Bad, "quoted"');
  });
});
