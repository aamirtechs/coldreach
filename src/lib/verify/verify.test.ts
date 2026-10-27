import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { dropTestDb, freshTestDb, seedWorkspace } from "@/lib/testing/testDb";
import { hasValidSyntax, runBuiltinChecks, type ResolveMx } from "./builtin";
import { isDisposableDomain } from "./disposable";
import { verifyProviderConfigured, verifyProviderMissingEnv, verifyWithProvider } from "./provider";
import { verifyLeadEmail, verifyList } from "./service";

describe("syntax validation", () => {
  it("accepts ordinary addresses", () => {
    expect(hasValidSyntax("ada@acme.com")).toBe(true);
    expect(hasValidSyntax("first.last+tag@sub.example.co.uk")).toBe(true);
  });

  it("rejects malformed addresses", () => {
    expect(hasValidSyntax("not-an-email")).toBe(false);
    expect(hasValidSyntax("missing@tld")).toBe(false);
    expect(hasValidSyntax("two@@example.com")).toBe(false);
    expect(hasValidSyntax(".leading@example.com")).toBe(false);
    expect(hasValidSyntax("trailing.@example.com")).toBe(false);
    expect(hasValidSyntax("double..dot@example.com")).toBe(false);
    expect(hasValidSyntax("spaces in@example.com")).toBe(false);
    expect(hasValidSyntax("")).toBe(false);
  });
});

describe("disposable domains (bundled partial list)", () => {
  it("flags known disposable domains and their subdomains", () => {
    expect(isDisposableDomain("mailinator.com")).toBe(true);
    expect(isDisposableDomain("sub.mailinator.com")).toBe(true);
    expect(isDisposableDomain("guerrillamail.com")).toBe(true);
    expect(isDisposableDomain("10minutemail.com")).toBe(true);
  });

  it("does not flag ordinary domains", () => {
    expect(isDisposableDomain("acme.com")).toBe(false);
    expect(isDisposableDomain("gmail.com")).toBe(false);
    expect(isDisposableDomain("")).toBe(false);
  });
});

const mxFound: ResolveMx = async () => "found";
const mxMissing: ResolveMx = async () => "missing";
const mxUnknown: ResolveMx = async () => "unknown";

describe("runBuiltinChecks with injected MX resolvers", () => {
  it("marks a syntactically valid address with MX records VALID", async () => {
    const result = await runBuiltinChecks("ada@acme.com", mxFound);
    expect(result.status).toBe("VALID");
    expect(result.syntax).toBe(true);
    expect(result.mx).toBe("found");
    expect(result.disposable).toBe(false);
  });

  it("marks bad syntax INVALID without consulting DNS", async () => {
    const resolver = vi.fn(mxFound);
    const result = await runBuiltinChecks("nope", resolver);
    expect(result.status).toBe("INVALID");
    expect(result.mx).toBe("skipped");
    expect(resolver).not.toHaveBeenCalled();
  });

  it("marks a domain with no MX records INVALID", async () => {
    const result = await runBuiltinChecks("ada@acme.com", mxMissing);
    expect(result.status).toBe("INVALID");
    expect(result.mx).toBe("missing");
  });

  it("marks disposable domains RISKY even with MX present", async () => {
    const result = await runBuiltinChecks("x@mailinator.com", mxFound);
    expect(result.status).toBe("RISKY");
    expect(result.disposable).toBe(true);
  });

  it("degrades to UNKNOWN when DNS cannot answer", async () => {
    const result = await runBuiltinChecks("ada@acme.com", mxUnknown);
    expect(result.status).toBe("UNKNOWN");
    expect(result.mx).toBe("unknown");
  });
});

describe("provider gating (NeverBounce)", () => {
  it("reports the exact missing variable when VERIFY_API_KEY is unset", () => {
    expect(verifyProviderMissingEnv({} as NodeJS.ProcessEnv)).toEqual(["VERIFY_API_KEY"]);
    expect(verifyProviderConfigured({} as NodeJS.ProcessEnv)).toBe(false);
    expect(verifyProviderMissingEnv({ VERIFY_API_KEY: "key" } as unknown as NodeJS.ProcessEnv)).toEqual([]);
    expect(verifyProviderConfigured({ VERIFY_API_KEY: "key" } as unknown as NodeJS.ProcessEnv)).toBe(true);
  });

  it("maps provider verdicts onto the shared status enum", async () => {
    const fetchFor = (result: string) =>
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ status: "success", result }),
      })) as unknown as typeof fetch;
    await expect(
      verifyWithProvider("a@acme.com", { apiKey: "k", fetchImpl: fetchFor("valid") }),
    ).resolves.toEqual({ result: "valid", status: "VALID" });
    await expect(
      verifyWithProvider("a@acme.com", { apiKey: "k", fetchImpl: fetchFor("invalid") }),
    ).resolves.toEqual({ result: "invalid", status: "INVALID" });
    await expect(
      verifyWithProvider("a@acme.com", { apiKey: "k", fetchImpl: fetchFor("disposable") }),
    ).resolves.toEqual({ result: "disposable", status: "RISKY" });
    await expect(
      verifyWithProvider("a@acme.com", { apiKey: "k", fetchImpl: fetchFor("catchall") }),
    ).resolves.toEqual({ result: "catchall", status: "RISKY" });
    await expect(
      verifyWithProvider("a@acme.com", { apiKey: "k", fetchImpl: fetchFor("unknown") }),
    ).resolves.toEqual({ result: "unknown", status: null });
  });

  it("throws on a provider API failure so the caller keeps the built-in verdict", async () => {
    const failing = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({ status: "failure", message: "boom" }),
    })) as unknown as typeof fetch;
    await expect(
      verifyWithProvider("a@acme.com", { apiKey: "k", fetchImpl: failing }),
    ).rejects.toThrow(/NeverBounce check failed/);
  });
});

describe("verifyLeadEmail composition", () => {
  it("runs built-in checks only when no provider key is configured", async () => {
    const result = await verifyLeadEmail("ada@acme.com", {
      resolveMx: mxFound,
      providerApiKey: null,
    });
    expect(result.status).toBe("VALID");
    expect(result.detail.provider).toBeNull();
    expect(result.detail.source).toBe("builtin");
  });

  it("skips the provider entirely for syntactically invalid addresses", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const result = await verifyLeadEmail("nope", {
      resolveMx: mxFound,
      providerApiKey: "k",
      fetchImpl,
    });
    expect(result.status).toBe("INVALID");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("lets a provider verdict refine a built-in one", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ status: "success", result: "invalid" }),
    })) as unknown as typeof fetch;
    const result = await verifyLeadEmail("ada@acme.com", {
      resolveMx: mxFound,
      providerApiKey: "k",
      fetchImpl,
    });
    expect(result.status).toBe("INVALID");
    expect(result.detail.provider).toEqual({ name: "neverbounce", result: "invalid" });
    expect(result.detail.source).toBe("builtin+provider");
  });

  it("keeps the built-in verdict and records the error when the provider fails", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({ status: "failure", message: "down" }),
    })) as unknown as typeof fetch;
    const result = await verifyLeadEmail("ada@acme.com", {
      resolveMx: mxFound,
      providerApiKey: "k",
      fetchImpl,
    });
    expect(result.status).toBe("VALID");
    expect(result.detail.providerError).toContain("NeverBounce check failed");
  });
});

const DB_NAME = "test-verify";
let db: PrismaClient;
let workspaceId: string;

beforeAll(async () => {
  db = freshTestDb(DB_NAME);
  const seeded = await seedWorkspace(db, "verify");
  workspaceId = seeded.workspace.id;
}, 120_000);

afterAll(async () => {
  await dropTestDb(db, DB_NAME);
});

describe("verifyList (database backed)", () => {
  it("verifies a whole list and stores per-lead results with a summary", async () => {
    const list = await db.leadList.create({ data: { workspaceId, name: "Verify me" } });
    const emails = ["good@acme.com", "broken-address", "temp@mailinator.com", "odd@unknowable.example"];
    for (const email of emails) {
      await db.lead.create({
        data: { workspaceId, listId: list.id, email, fields: {}, tags: [], status: "NEW" },
      });
    }
    const resolveMx: ResolveMx = async (domain) =>
      domain === "unknowable.example" ? "unknown" : "found";
    const summary = await verifyList(
      db,
      { workspaceId, listId: list.id },
      { resolveMx, providerApiKey: null },
    );
    expect(summary.total).toBe(4);
    expect(summary.valid).toBe(1);
    expect(summary.invalid).toBe(1);
    expect(summary.risky).toBe(1);
    expect(summary.unknown).toBe(1);
    expect(summary.providerConfigured).toBe(false);

    const stored = await db.lead.findMany({ where: { listId: list.id }, orderBy: { email: "asc" } });
    const byEmail = new Map(stored.map((lead) => [lead.email, lead]));
    expect(byEmail.get("good@acme.com")?.verificationStatus).toBe("VALID");
    expect(byEmail.get("broken-address")?.verificationStatus).toBe("INVALID");
    expect(byEmail.get("temp@mailinator.com")?.verificationStatus).toBe("RISKY");
    expect(byEmail.get("odd@unknowable.example")?.verificationStatus).toBe("UNKNOWN");
    expect(byEmail.get("good@acme.com")?.verifiedAt).not.toBeNull();
    expect(byEmail.get("good@acme.com")?.verificationDetail).toMatchObject({ mx: "found" });
  });

  it("is tenant isolated: a list owned by another workspace is not found", async () => {
    const list = await db.leadList.create({ data: { workspaceId, name: "Not yours" } });
    const other = await seedWorkspace(db, "verify-other");
    await expect(
      verifyList(db, { workspaceId: other.workspace.id, listId: list.id }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(verifyList(db, { workspaceId, listId: "missing" })).rejects.toMatchObject({
      status: 404,
    });
  });
});
