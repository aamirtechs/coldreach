import { describe, expect, it } from "vitest";
import { verifyImportEmails } from "./importVerify";
import type { ResolveMx } from "@/lib/verify/builtin";

const mxFound: ResolveMx = async () => "found";
const mxByDomain: ResolveMx = async (domain) =>
  domain === "unknowable.example" ? "unknown" : "found";

describe("verifyImportEmails (import wizard step 2)", () => {
  it("verifies unique addresses once and returns counts plus verdicts", async () => {
    const csv = [
      "Email,First Name",
      "good@acme.com,Ada",
      "GOOD@acme.com,Ada Again",
      "broken-address,Nope",
      "temp@mailinator.com,Temp",
      "odd@unknowable.example,Odd",
    ].join("\n");
    const result = await verifyImportEmails(csv, "Email", {
      resolveMx: mxByDomain,
      reacherUrl: null,
    });
    expect(result.totalRows).toBe(5);
    expect(result.uniqueEmails).toBe(4);
    expect(result.counts).toEqual({ valid: 1, risky: 1, invalid: 1, unknown: 1 });
    expect(result.verdicts["good@acme.com"].status).toBe("VALID");
    expect(result.verdicts["broken-address"].status).toBe("INVALID");
    expect(result.verdicts["temp@mailinator.com"].status).toBe("RISKY");
    expect(result.verdicts["odd@unknowable.example"].status).toBe("UNKNOWN");
  });

  it("rejects a file whose email column is missing", async () => {
    await expect(
      verifyImportEmails("Name\nAda", "Email", { resolveMx: mxFound, reacherUrl: null }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("refines verdicts through Reacher when the sidecar answers", async () => {
    const fetchImpl = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({ is_reachable: "invalid" }),
    })) as unknown as typeof fetch;
    const result = await verifyImportEmails("Email\nghost@acme.com", "Email", {
      resolveMx: mxFound,
      reacherUrl: "http://reacher.test",
      fetchImpl,
    });
    expect(result.counts.invalid).toBe(1);
    expect(result.verdicts["ghost@acme.com"].detail.provider).toEqual({
      name: "reacher",
      result: "invalid",
    });
  });
});
