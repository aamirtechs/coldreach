import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { dropTestDb, freshTestDb, seedWorkspace } from "@/lib/testing/testDb";
import { buildWorkspaceExport } from "./export";

const DB_NAME = "test-export";
let db: PrismaClient;
let workspaceId: string;

const SECRET_VALUES = [
  "not-a-real-hash", // the seeded user's passwordHash (testDb seed)
  "ACME_SMTP", // the sending account credentialRef
  "v1.ciphertext-blob", // the encrypted OAuth credentials blob
  "whsec_super_secret_value", // the webhook endpoint secret
  "hashed-invite-token", // the invite tokenHash
  "deadbeef-key-hash", // the API key hash
  "cus_should_not_leak", // the Stripe customer id
  "p@ssw0rd-in-metadata", // a password smuggled into audit metadata
];

function collectKeys(value: unknown, into: Set<string>): void {
  if (Array.isArray(value)) {
    for (const entry of value) collectKeys(entry, into);
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      into.add(key);
      collectKeys(entry, into);
    }
  }
}

beforeAll(async () => {
  db = freshTestDb(DB_NAME);
  const { user, workspace } = await seedWorkspace(db, "export");
  workspaceId = workspace.id;

  const list = await db.leadList.create({
    data: { workspaceId, name: "Export List" },
  });
  const lead = await db.lead.create({
    data: {
      workspaceId,
      listId: list.id,
      email: "lead@example.com",
      fields: { firstName: "Lee" },
      tags: ["warm"],
      status: "VALID",
    },
  });
  const account = await db.sendingAccount.create({
    data: {
      workspaceId,
      email: "sender@example.com",
      provider: "SMTP",
      status: "CONNECTED",
      credentialRef: "ACME_SMTP",
      encryptedCredentials: "v1.ciphertext-blob",
    },
  });
  const campaign = await db.campaign.create({
    data: { workspaceId, name: "Export Campaign", status: "RUNNING", leadListId: list.id },
  });
  const step = await db.sequenceStep.create({
    data: { campaignId: campaign.id, order: 0, subject: "Hi", body: "Body" },
  });
  await db.stepVariant.create({
    data: { stepId: step.id, label: "B", bodyText: "Alt body" },
  });
  await db.campaignAccount.create({
    data: { campaignId: campaign.id, sendingAccountId: account.id },
  });
  await db.enrollment.create({
    data: { campaignId: campaign.id, leadId: lead.id, status: "ACTIVE" },
  });
  await db.suppression.create({
    data: { workspaceId, scope: "WORKSPACE", email: "gone@example.com", reason: "Unsubscribed" },
  });
  const thread = await db.thread.create({
    data: {
      workspaceId,
      campaignId: campaign.id,
      leadId: lead.id,
      sendingAccountId: account.id,
      subject: "Re: Hi",
      status: "OPEN",
    },
  });
  await db.threadMessage.create({
    data: {
      threadId: thread.id,
      direction: "INBOUND",
      fromEmail: "lead@example.com",
      toEmail: "sender@example.com",
      body: "Sounds interesting",
    },
  });
  await db.threadNote.create({
    data: { workspaceId, threadId: thread.id, authorId: user.id, body: "Call them Tuesday" },
  });
  await db.subscription.create({
    data: {
      workspaceId,
      plan: "STARTER",
      stripeCustomerId: "cus_should_not_leak",
      stripeSubscriptionId: "sub_should_not_leak",
    },
  });
  await db.apiKey.create({
    data: {
      workspaceId,
      name: "Export key",
      keyHash: "deadbeef-key-hash",
      prefix: "cr_live_ab",
      scopes: ["leads:read"],
      createdById: user.id,
    },
  });
  await db.webhookEndpoint.create({
    data: {
      workspaceId,
      url: "https://hooks.example.com/coldreach",
      secret: "whsec_super_secret_value",
      eventTypes: ["REPLIED"],
    },
  });
  await db.invite.create({
    data: {
      workspaceId,
      email: "teammate@example.com",
      role: "MEMBER",
      tokenHash: "hashed-invite-token",
      expiresAt: new Date(Date.now() + 86_400_000),
      invitedById: user.id,
    },
  });
  await db.auditLog.create({
    data: {
      workspaceId,
      userId: user.id,
      action: "test.seed",
      metadata: { smtpPassword: "p@ssw0rd-in-metadata", note: "kept" },
    },
  });
}, 60_000);

afterAll(async () => {
  await dropTestDb(db, DB_NAME);
});

describe("buildWorkspaceExport", () => {
  it("exports the workspace's core data", async () => {
    const payload = await buildWorkspaceExport(db, workspaceId);
    expect(payload).not.toBeNull();
    const data = payload as NonNullable<typeof payload>;
    expect(data.format).toBe("coldreach-workspace-export");
    expect(data.members).toHaveLength(1);
    expect(data.members[0].email).toContain("@example.com");
    expect(data.leadLists).toHaveLength(1);
    expect(data.leadLists[0].leadCount).toBe(1);
    expect(data.leads).toHaveLength(1);
    expect(data.campaigns).toHaveLength(1);
    expect(data.campaigns[0].sendingAccountIds).toHaveLength(1);
    expect(data.steps).toHaveLength(1);
    expect(data.variants).toHaveLength(1);
    expect(data.enrollmentCounts).toEqual([
      { campaignId: expect.any(String), status: "ACTIVE", count: 1 },
    ]);
    expect(data.suppressions).toHaveLength(1);
    expect(data.sendingAccounts).toHaveLength(1);
    expect(data.threads).toHaveLength(1);
    expect(data.threads[0].messages).toHaveLength(1);
    expect(data.threads[0].notes).toHaveLength(1);
    expect(data.subscription?.plan).toBe("STARTER");
    expect(data.apiKeys[0].prefix).toBe("cr_live_ab");
    expect(data.webhookEndpoints[0].url).toContain("hooks.example.com");
    expect(data.invites).toHaveLength(1);
    expect(data.auditLog.total).toBeGreaterThanOrEqual(1);
  });

  it("never includes credential material, by value or by key name", async () => {
    const payload = await buildWorkspaceExport(db, workspaceId);
    const serialized = JSON.stringify(payload);
    for (const secret of SECRET_VALUES) {
      expect(serialized).not.toContain(secret);
    }
    const keys = new Set<string>();
    collectKeys(payload, keys);
    for (const forbidden of [
      "passwordHash",
      "keyHash",
      "tokenHash",
      "secret",
      "credentialRef",
      "encryptedCredentials",
      "stripeCustomerId",
      "stripeSubscriptionId",
      "providerAccountId",
      "smtpPassword",
    ]) {
      expect(keys.has(forbidden)).toBe(false);
    }
  });

  it("keeps harmless audit metadata while stripping credential keys", async () => {
    const payload = await buildWorkspaceExport(db, workspaceId);
    const entry = payload?.auditLog.entries.find((row) => row.action === "test.seed");
    expect(entry).toBeDefined();
    expect(entry?.metadata).toEqual({ note: "kept" });
  });

  it("returns null for an unknown workspace", async () => {
    expect(await buildWorkspaceExport(db, "does-not-exist")).toBeNull();
  });
});
