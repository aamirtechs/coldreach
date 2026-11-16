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
      json: async () => ({ is_reachable: "invalid", smtp: { is_disabled: true } }),
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

describe("verifyImportEmails progress streaming (v1.35.0)", () => {
  it("reports progress after every address with cumulative counts", async () => {
    const events: { done: number; total: number; valid: number }[] = [];
    const csv = ["Email", "one@acme.com", "two@acme.com", "broken"].join("\n");
    const result = await verifyImportEmails(
      csv,
      "Email",
      { resolveMx: mxFound, reacherUrl: null },
      {
        onProgress: (p) =>
          events.push({ done: p.done, total: p.total, valid: p.counts.valid }),
      },
    );
    expect(result.uniqueEmails).toBe(3);
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.done).sort()).toEqual([1, 2, 3]);
    expect(events.every((e) => e.total === 3)).toBe(true);
    expect(events.reduce((max, e) => Math.max(max, e.valid), 0)).toBe(2);
  });

  it("stops starting new probes when shouldStop fires and throws", async () => {
    let calls = 0;
    const csv = ["Email", "one@acme.com", "two@acme.com", "three@acme.com"].join("\n");
    await expect(
      verifyImportEmails(
        csv,
        "Email",
        { resolveMx: mxFound, reacherUrl: null },
        {
          shouldStop: () => {
            calls += 1;
            return calls > 1;
          },
        },
      ),
    ).rejects.toMatchObject({ status: 499 });
  });
});
