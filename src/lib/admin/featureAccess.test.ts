import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { dropTestDb, freshTestDb } from "@/lib/testing/testDb";
import {
  canUseVerification,
  isVerificationPublicEnabled,
  setVerificationPublicEnabled,
} from "./featureAccess";

const DB_NAME = "feature-access-test.db";
const OWNER = "owner@example.com";
const CUSTOMER = "customer@example.com";

let db: PrismaClient;

beforeAll(() => {
  process.env.PLATFORM_OWNER_EMAIL = OWNER;
  db = freshTestDb(DB_NAME);
});

afterAll(async () => {
  delete process.env.PLATFORM_OWNER_EMAIL;
  await dropTestDb(db, DB_NAME);
});

describe("verification feature access", () => {
  it("is closed to customers by default and open to the owner", async () => {
    await expect(isVerificationPublicEnabled(db)).resolves.toBe(false);
    await expect(canUseVerification(db, CUSTOMER)).resolves.toBe(false);
    await expect(canUseVerification(db, OWNER)).resolves.toBe(true);
    await expect(canUseVerification(db, null)).resolves.toBe(false);
  });

  it("opens to everyone when the admin switch is on", async () => {
    await setVerificationPublicEnabled(db, true);
    await expect(isVerificationPublicEnabled(db)).resolves.toBe(true);
    await expect(canUseVerification(db, CUSTOMER)).resolves.toBe(true);
    await expect(canUseVerification(db, OWNER)).resolves.toBe(true);
  });

  it("closes again when the switch is turned back off, owner unaffected", async () => {
    await setVerificationPublicEnabled(db, false);
    await expect(isVerificationPublicEnabled(db)).resolves.toBe(false);
    await expect(canUseVerification(db, CUSTOMER)).resolves.toBe(false);
    await expect(canUseVerification(db, OWNER)).resolves.toBe(true);
  });
});
