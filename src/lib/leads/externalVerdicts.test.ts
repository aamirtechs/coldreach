import { describe, expect, it } from "vitest";
import {
  buildExternalVerdicts,
  guessExternalVerdictColumn,
  mapExternalVerdict,
} from "./externalVerdicts";

describe("mapExternalVerdict", () => {
  it("maps MillionVerifier result values", () => {
    expect(mapExternalVerdict("ok")).toBe("VALID");
    expect(mapExternalVerdict("catch_all")).toBe("RISKY");
    expect(mapExternalVerdict("invalid")).toBe("INVALID");
    expect(mapExternalVerdict("disposable")).toBe("INVALID");
  });

  it("maps MillionVerifier quality values", () => {
    expect(mapExternalVerdict("good")).toBe("VALID");
    expect(mapExternalVerdict("risky")).toBe("RISKY");
    expect(mapExternalVerdict("bad")).toBe("INVALID");
  });

  it("maps common generic vocabularies", () => {
    expect(mapExternalVerdict("valid")).toBe("VALID");
    expect(mapExternalVerdict("deliverable")).toBe("VALID");
    expect(mapExternalVerdict("safe")).toBe("VALID");
    expect(mapExternalVerdict("accept-all")).toBe("RISKY");
    expect(mapExternalVerdict("undeliverable")).toBe("INVALID");
    expect(mapExternalVerdict("mailbox_not_found")).toBe("INVALID");
    expect(mapExternalVerdict("unknown")).toBe("UNKNOWN");
    expect(mapExternalVerdict("error")).toBe("UNKNOWN");
  });

  it("is case and separator insensitive", () => {
    expect(mapExternalVerdict(" OK ")).toBe("VALID");
    expect(mapExternalVerdict("Catch_All")).toBe("RISKY");
    expect(mapExternalVerdict("INVALID")).toBe("INVALID");
  });

  it("never guesses an unrecognized value into Good", () => {
    expect(mapExternalVerdict("")).toBe("UNKNOWN");
    expect(mapExternalVerdict("pending_review")).toBe("UNKNOWN");
    expect(mapExternalVerdict("some custom label")).toBe("UNKNOWN");
  });
});

describe("guessExternalVerdictColumn", () => {
  it("prefers the result column in a MillionVerifier report", () => {
    expect(guessExternalVerdictColumn(["email", "quality", "result", "free", "role"])).toBe(
      "result",
    );
  });

  it("finds generic status columns", () => {
    expect(guessExternalVerdictColumn(["Email", "Status", "Name"])).toBe("Status");
    expect(guessExternalVerdictColumn(["email", "verification_status"])).toBe(
      "verification_status",
    );
  });

  it("returns empty when nothing looks like a verdict column", () => {
    expect(guessExternalVerdictColumn(["email", "first_name", "company"])).toBe("");
  });
});

describe("buildExternalVerdicts", () => {
  const csv = [
    "email,result,company",
    "good@acme.com,ok,Acme",
    "catch@acme.com,catch_all,Acme",
    "dead@acme.com,invalid,Acme",
    "mystery@acme.com,pending,Acme",
    "good@acme.com,invalid,Acme Duplicate Row",
    ",ok,No Email",
  ].join("\n");

  it("builds verdicts from the file with no probing", () => {
    const result = buildExternalVerdicts(csv, "email", "result");
    expect(result.totalRows).toBe(6);
    expect(result.uniqueEmails).toBe(4);
    expect(result.counts).toEqual({ valid: 1, risky: 1, invalid: 1, unknown: 1 });
    expect(result.verdicts["good@acme.com"].status).toBe("VALID");
    expect(result.verdicts["catch@acme.com"].status).toBe("RISKY");
    expect(result.verdicts["dead@acme.com"].status).toBe("INVALID");
    expect(result.verdicts["mystery@acme.com"].status).toBe("UNKNOWN");
  });

  it("keeps the first occurrence on duplicate addresses", () => {
    const result = buildExternalVerdicts(csv, "email", "result");
    expect(result.verdicts["good@acme.com"].status).toBe("VALID");
  });

  it("marks the stored detail as external with the raw value", () => {
    const result = buildExternalVerdicts(csv, "email", "result");
    const detail = result.verdicts["catch@acme.com"].detail;
    expect(detail.source).toBe("external");
    expect(detail.provider).toEqual({ name: "external", result: "catch_all" });
    expect(detail.reasons.join(" ")).toContain("ColdReach verification was skipped");
  });

  it("rejects a missing verdict column with a 400", () => {
    expect(() => buildExternalVerdicts(csv, "email", "nope")).toThrowError(
      expect.objectContaining({ status: 400 }),
    );
  });

  it("rejects a missing email column with a 400", () => {
    expect(() => buildExternalVerdicts(csv, "nope", "result")).toThrowError(
      expect.objectContaining({ status: 400 }),
    );
  });
});
