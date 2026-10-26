import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { dropTestDb, freshTestDb, seedWorkspace } from "@/lib/testing/testDb";
import { FakeSource } from "./fakeSource";
import { syncAccount } from "./syncService";
import type { NormalizedInboundMessage } from "./types";

const DB_NAME = "test-sync";
let db: PrismaClient;
let workspaceId: string;
let accountId: string;
let enrollmentId: string;

const REPLY: NormalizedInboundMessage = {
  providerMessageId: "reply-1@mail.example.com",
  fromEmail: "prospect@example.com",
  toEmail: "sender@example.com",
  subject: "Re: Quick intro",
  bodyText: "Yes, I am interested. Can we book a call next week to talk details?",
  receivedAt: new Date("2026-10-26T10:00:00Z"),
  inReplyTo: "sent-1@coldreach",
  references: ["sent-1@coldreach"],
};

beforeAll(async () => {
  db = freshTestDb(DB_NAME);
  const seeded = await seedWorkspace(db, "sync");
  workspaceId = seeded.workspace.id;

  const account = await db.sendingAccount.create({
    data: {
      workspaceId,
      email: "sender@example.com",
      provider: "GMAIL",
      status: "CONNECTED",
      dailyLimit: 100,
    },
  });
  accountId = account.id;
  const list = await db.leadList.create({ data: { workspaceId, name: "Sync list" } });
  const lead = await db.lead.create({
    data: {
      workspaceId,
      listId: list.id,
      email: "prospect@example.com",
      fields: { firstName: "Pat" },
      tags: [],
      status: "NEW",
    },
  });
  const campaign = await db.campaign.create({
    data: { workspaceId, name: "Sync campaign", status: "RUNNING", leadListId: list.id },
  });
  const enrollment = await db.enrollment.create({
    data: {
      campaignId: campaign.id,
      leadId: lead.id,
      status: "ACTIVE",
      nextSendAt: new Date("2026-10-27T10:00:00Z"),
    },
  });
  enrollmentId = enrollment.id;
  await db.emailEvent.create({
    data: {
      workspaceId,
      campaignId: campaign.id,
      enrollmentId: enrollment.id,
      sendingAccountId: account.id,
      type: "SENT",
      providerMessageId: "sent-1@coldreach",
      idempotencyKey: "send:sync:1",
      occurredAt: new Date("2026-10-25T10:00:00Z"),
    },
  });
});

afterAll(async () => {
  await dropTestDb(db, DB_NAME);
});

describe("syncAccount with FakeSource", () => {
  it("imports a reply, threads it, classifies it, and stops the enrollment", async () => {
    const account = await db.sendingAccount.findUniqueOrThrow({ where: { id: accountId } });
    const summary = await syncAccount(db, account, { source: new FakeSource([REPLY]) });
    expect(summary.fetched).toBe(1);
    expect(summary.imported).toBe(1);
    expect(summary.repliesApplied).toBe(1);
    expect(summary.threadsCreated).toBe(1);

    const enrollment = await db.enrollment.findUniqueOrThrow({ where: { id: enrollmentId } });
    expect(enrollment.status).toBe("REPLIED");
    expect(enrollment.nextSendAt).toBeNull();

    const replyEvent = await db.emailEvent.findFirst({
      where: { workspaceId, type: "REPLIED", enrollmentId },
    });
    expect(replyEvent?.classification).toBe("POSITIVE");
    expect(replyEvent?.providerMessageId).toBe("reply-1@mail.example.com");

    const thread = await db.thread.findFirst({ where: { workspaceId } });
    expect(thread).not.toBeNull();
    expect(thread?.unread).toBe(true);
    expect(thread?.classification).toBe("POSITIVE");
    expect(thread?.subject).toBe("Re: Quick intro");
    const messages = await db.threadMessage.findMany({ where: { threadId: thread?.id } });
    expect(messages).toHaveLength(1);
    expect(messages[0].direction).toBe("INBOUND");
    expect(messages[0].body).toContain("book a call");

    const updated = await db.sendingAccount.findUniqueOrThrow({ where: { id: accountId } });
    expect(updated.syncCursor).toBe("fake-cursor");
    expect(updated.lastSyncAt).not.toBeNull();
  });

  it("is idempotent: a second sync of the same message changes nothing", async () => {
    const account = await db.sendingAccount.findUniqueOrThrow({ where: { id: accountId } });
    const summary = await syncAccount(db, account, { source: new FakeSource([REPLY]) });
    expect(summary.imported).toBe(0);
    expect(summary.duplicates).toBe(1);
    expect(summary.repliesApplied).toBe(0);
    const messageCount = await db.threadMessage.count({ where: { thread: { workspaceId } } });
    expect(messageCount).toBe(1);
    const replyEvents = await db.emailEvent.count({
      where: { workspaceId, type: "REPLIED", enrollmentId },
    });
    expect(replyEvents).toBe(1);
  });

  it("classifies an out of office reply and threads it on the same conversation", async () => {
    const ooo: NormalizedInboundMessage = {
      providerMessageId: "reply-2@mail.example.com",
      fromEmail: "prospect@example.com",
      toEmail: "sender@example.com",
      subject: "Re: Quick intro",
      bodyText: "I am out of office until Monday with limited access to email.",
      receivedAt: new Date("2026-10-26T12:00:00Z"),
      inReplyTo: "sent-1@coldreach",
      references: ["sent-1@coldreach"],
    };
    const account = await db.sendingAccount.findUniqueOrThrow({ where: { id: accountId } });
    const summary = await syncAccount(db, account, { source: new FakeSource([ooo]) });
    expect(summary.imported).toBe(1);
    expect(summary.threadsCreated).toBe(0);
    const thread = await db.thread.findFirst({ where: { workspaceId } });
    expect(thread?.classification).toBe("OUT_OF_OFFICE");
    const messages = await db.threadMessage.count({ where: { threadId: thread?.id } });
    expect(messages).toBe(2);
  });

  it("threads a message from an unknown sender without inventing an enrollment", async () => {
    const stranger: NormalizedInboundMessage = {
      providerMessageId: "cold-1@mail.other.example",
      fromEmail: "stranger@other.example",
      toEmail: "sender@example.com",
      subject: "Question about pricing",
      bodyText: "Hi, what does the team plan cost?",
      receivedAt: new Date("2026-10-26T13:00:00Z"),
      inReplyTo: null,
      references: [],
    };
    const account = await db.sendingAccount.findUniqueOrThrow({ where: { id: accountId } });
    const summary = await syncAccount(db, account, { source: new FakeSource([stranger]) });
    expect(summary.imported).toBe(1);
    expect(summary.repliesApplied).toBe(0);
    const thread = await db.thread.findFirst({
      where: { workspaceId, subject: "Question about pricing" },
    });
    expect(thread?.leadId).toBeNull();
  });
});
