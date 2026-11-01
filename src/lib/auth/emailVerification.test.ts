import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  hashVerificationToken,
  isLoginBlockedByVerification,
  issueVerificationToken,
  sendVerificationEmail,
  verificationRequired,
  verifyEmailToken,
} from "./emailVerification";
import { dropTestDb, freshTestDb, seedWorkspace } from "@/lib/testing/testDb";

const DB_NAME = "test-email-verification";
let db: PrismaClient;
let userId: string;
let userEmail: string;

beforeAll(async () => {
  db = freshTestDb(DB_NAME);
  const seeded = await seedWorkspace(db, "verify");
  userId = seeded.user.id;
  userEmail = seeded.user.email;
});

afterAll(async () => {
  await dropTestDb(db, DB_NAME);
});

describe("verificationRequired", () => {
  it("follows product mail configuration", () => {
    expect(verificationRequired({ RESEND_API_KEY: "re_x" } as unknown as NodeJS.ProcessEnv)).toBe(true);
    expect(verificationRequired({} as unknown as NodeJS.ProcessEnv)).toBe(false);
  });
});

describe("isLoginBlockedByVerification", () => {
  const ON = { RESEND_API_KEY: "re_x" } as unknown as NodeJS.ProcessEnv;
  const OFF = {} as unknown as NodeJS.ProcessEnv;

  it("blocks only enforcement-era accounts that are still unverified, and only while enforced", () => {
    expect(
      isLoginBlockedByVerification({ emailVerifiedAt: null, requiresEmailVerification: true }, ON),
    ).toBe(true);
    // Verified since: free.
    expect(
      isLoginBlockedByVerification({ emailVerifiedAt: new Date(), requiresEmailVerification: true }, ON),
    ).toBe(false);
    // Pre-enforcement account: never blocked.
    expect(
      isLoginBlockedByVerification({ emailVerifiedAt: null, requiresEmailVerification: false }, ON),
    ).toBe(false);
    // Enforcement off: nobody blocked.
    expect(
      isLoginBlockedByVerification({ emailVerifiedAt: null, requiresEmailVerification: true }, OFF),
    ).toBe(false);
  });
});

describe("token lifecycle", () => {
  it("stores only the hash and verifies the raw token once", async () => {
    const raw = await issueVerificationToken(db, userId);
    const stored = await db.emailVerificationToken.findFirst({ where: { userId } });
    expect(stored?.tokenHash).toBe(hashVerificationToken(raw));
    expect(stored?.tokenHash).not.toBe(raw);

    const first = await verifyEmailToken(db, raw);
    expect(first).toEqual({ ok: true, userId });
    const user = await db.user.findUnique({ where: { id: userId } });
    expect(user?.emailVerifiedAt).not.toBeNull();

    const second = await verifyEmailToken(db, raw);
    expect(second).toEqual({ ok: false, reason: "used" });
  });

  it("rejects unknown and expired tokens", async () => {
    expect(await verifyEmailToken(db, "not-a-real-token")).toEqual({ ok: false, reason: "invalid" });
    const raw = await issueVerificationToken(db, userId);
    await db.emailVerificationToken.updateMany({
      where: { userId },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    expect(await verifyEmailToken(db, raw)).toEqual({ ok: false, reason: "expired" });
  });

  it("issuing a new token invalidates the previous one", async () => {
    const first = await issueVerificationToken(db, userId);
    const second = await issueVerificationToken(db, userId);
    expect(await verifyEmailToken(db, first)).toEqual({ ok: false, reason: "invalid" });
    expect(await verifyEmailToken(db, second)).toEqual({ ok: true, userId });
  });
});

describe("sendVerificationEmail", () => {
  it("emails a working verification link to the user", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: "msg-9" }), { status: 200 }));
    const result = await sendVerificationEmail(
      db,
      { id: userId, email: userEmail, name: "Test Owner" },
      { env: { RESEND_API_KEY: "re_x", APP_URL: "https://app.example.com" } as unknown as NodeJS.ProcessEnv, fetchImpl },
    );
    expect(result.sent).toBe(true);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { to: string[]; text: string };
    expect(body.to).toEqual([userEmail]);
    const match = body.text.match(/\/verify-email\?token=([A-Za-z0-9_-]+)/);
    expect(match).not.toBeNull();
    expect(await verifyEmailToken(db, match![1])).toEqual({ ok: true, userId });
  });
});
