import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { dropTestDb, freshTestDb, seedWorkspace } from "@/lib/testing/testDb";
import {
  createSupportTicket,
  listPlatformTickets,
  listWorkspaceTickets,
  setSupportTicketStatus,
  supportEmail,
  validateTicketInput,
} from "./tickets";
import { DEFAULT_SUPPORT_EMAIL, SUPPORT_CATEGORIES } from "./constants";

type MailInput = { to: string; subject: string; text: string; replyTo?: string };

const DB_NAME = "test-support-tickets";
let db: PrismaClient;

beforeAll(async () => {
  db = freshTestDb(DB_NAME);
});

afterAll(async () => {
  await dropTestDb(db, DB_NAME);
});

const VALID = {
  subject: "Campaigns stopped sending",
  category: "Sending problem" as const,
  message: "Nothing has gone out since this morning.",
};

describe("validateTicketInput", () => {
  it("accepts a well formed ticket and trims whitespace", () => {
    const result = validateTicketInput({
      subject: "  Help  ",
      category: "Billing",
      message: "  Charged twice  ",
    });
    expect(result).toEqual({ ok: true, subject: "Help", category: "Billing", message: "Charged twice" });
  });

  it("rejects a missing subject, an unknown category, and an empty message", () => {
    expect(validateTicketInput({ subject: "", category: "Billing", message: "x" }).ok).toBe(false);
    expect(
      validateTicketInput({ subject: "Hi", category: "Nonsense", message: "x" }),
    ).toEqual({ ok: false, error: "Choose a category from the list" });
    expect(validateTicketInput({ subject: "Hi", category: "Billing", message: "  " }).ok).toBe(false);
  });

  it("rejects over-length subject and message", () => {
    expect(
      validateTicketInput({ subject: "a".repeat(151), category: "Billing", message: "x" }).ok,
    ).toBe(false);
    expect(
      validateTicketInput({ subject: "Hi", category: "Billing", message: "a".repeat(5001) }).ok,
    ).toBe(false);
  });

  it("accepts every category the form offers", () => {
    for (const category of SUPPORT_CATEGORIES) {
      expect(validateTicketInput({ subject: "Hi", category, message: "Body" }).ok).toBe(true);
    }
  });
});

describe("supportEmail", () => {
  it("defaults to the support inbox and honors the SUPPORT_EMAIL override", () => {
    expect(supportEmail({} as NodeJS.ProcessEnv)).toBe(DEFAULT_SUPPORT_EMAIL);
    expect(
      supportEmail({ SUPPORT_EMAIL: "help@example.com" } as unknown as NodeJS.ProcessEnv),
    ).toBe("help@example.com");
  });
});

describe("createSupportTicket", () => {
  it("persists the ticket with the reporter's identity and OPEN status", async () => {
    const { user, workspace } = await seedWorkspace(db, "support-a");
    const sendMail = vi.fn(async (_input: MailInput) => ({ sent: true, id: "msg-1" }));
    const { ticket, emailSent } = await createSupportTicket(
      db,
      {
        userId: user.id,
        userEmail: user.email,
        workspaceId: workspace.id,
        workspaceName: workspace.name,
      },
      VALID,
      { env: {} as NodeJS.ProcessEnv, sendMail },
    );
    expect(emailSent).toBe(true);
    expect(ticket.status).toBe("OPEN");
    expect(ticket.userEmail).toBe(user.email);
    expect(ticket.workspaceId).toBe(workspace.id);
    const stored = await db.supportTicket.findUnique({ where: { id: ticket.id } });
    expect(stored?.subject).toBe(VALID.subject);
    expect(stored?.category).toBe(VALID.category);
  });

  it("emails the support inbox with the ticket details and the user as reply-to", async () => {
    const { user, workspace } = await seedWorkspace(db, "support-b");
    const sendMail = vi.fn(async (_input: MailInput) => ({ sent: true, id: "msg-2" }));
    await createSupportTicket(
      db,
      {
        userId: user.id,
        userEmail: user.email,
        workspaceId: workspace.id,
        workspaceName: workspace.name,
      },
      VALID,
      { env: {} as NodeJS.ProcessEnv, sendMail },
    );
    expect(sendMail).toHaveBeenCalledTimes(1);
    const input = sendMail.mock.calls[0][0];
    expect(input.to).toBe(DEFAULT_SUPPORT_EMAIL);
    expect(input.replyTo).toBe(user.email);
    expect(input.subject).toContain(VALID.subject);
    expect(input.text).toContain(VALID.category);
    expect(input.text).toContain(workspace.name);
    expect(input.text).toContain(workspace.id);
    expect(input.text).toContain(VALID.message);
  });

  it("uses the SUPPORT_EMAIL override as the recipient", async () => {
    const { user, workspace } = await seedWorkspace(db, "support-c");
    const sendMail = vi.fn(async (_input: MailInput) => ({ sent: true, id: "msg-3" }));
    await createSupportTicket(
      db,
      {
        userId: user.id,
        userEmail: user.email,
        workspaceId: workspace.id,
        workspaceName: workspace.name,
      },
      VALID,
      {
        env: { SUPPORT_EMAIL: "help@example.com" } as unknown as NodeJS.ProcessEnv,
        sendMail,
      },
    );
    expect(sendMail.mock.calls[0][0].to).toBe("help@example.com");
  });

  it("still saves the ticket when the notification email is not configured", async () => {
    const { user, workspace } = await seedWorkspace(db, "support-d");
    const sendMail = vi.fn(async (_input: MailInput) => ({ sent: false, reason: "not_configured" }));
    const { ticket, emailSent } = await createSupportTicket(
      db,
      {
        userId: user.id,
        userEmail: user.email,
        workspaceId: workspace.id,
        workspaceName: workspace.name,
      },
      VALID,
      { env: {} as NodeJS.ProcessEnv, sendMail },
    );
    expect(emailSent).toBe(false);
    const stored = await db.supportTicket.findUnique({ where: { id: ticket.id } });
    expect(stored).not.toBeNull();
  });

  it("still saves the ticket when the mail sender throws", async () => {
    const { user, workspace } = await seedWorkspace(db, "support-e");
    const sendMail = vi.fn(async (_input: MailInput) => {
      throw new Error("provider down");
    });
    const { ticket, emailSent } = await createSupportTicket(
      db,
      {
        userId: user.id,
        userEmail: user.email,
        workspaceId: workspace.id,
        workspaceName: workspace.name,
      },
      VALID,
      { env: {} as NodeJS.ProcessEnv, sendMail },
    );
    expect(emailSent).toBe(false);
    expect(await db.supportTicket.findUnique({ where: { id: ticket.id } })).not.toBeNull();
  });
});

describe("ticket listing and status", () => {
  it("lists only the workspace's own tickets, newest first", async () => {
    const first = await seedWorkspace(db, "support-f");
    const second = await seedWorkspace(db, "support-g");
    const sendMail = vi.fn(async (_input: MailInput) => ({ sent: true, id: "m" }));
    const deps = { env: {} as NodeJS.ProcessEnv, sendMail };
    await createSupportTicket(
      db,
      { userId: first.user.id, userEmail: first.user.email, workspaceId: first.workspace.id, workspaceName: first.workspace.name },
      { ...VALID, subject: "First ticket" },
      deps,
    );
    await createSupportTicket(
      db,
      { userId: second.user.id, userEmail: second.user.email, workspaceId: second.workspace.id, workspaceName: second.workspace.name },
      { ...VALID, subject: "Other workspace ticket" },
      deps,
    );
    const mine = await listWorkspaceTickets(db, first.workspace.id);
    expect(mine.map((t) => t.subject)).toEqual(["First ticket"]);
  });

  it("platform list spans workspaces and status updates persist", async () => {
    const { user, workspace } = await seedWorkspace(db, "support-h");
    const sendMail = vi.fn(async (_input: MailInput) => ({ sent: true, id: "m" }));
    const { ticket } = await createSupportTicket(
      db,
      { userId: user.id, userEmail: user.email, workspaceId: workspace.id, workspaceName: workspace.name },
      VALID,
      { env: {} as NodeJS.ProcessEnv, sendMail },
    );
    const all = await listPlatformTickets(db);
    expect(all.some((t) => t.id === ticket.id)).toBe(true);
    const closed = await setSupportTicketStatus(db, ticket.id, "CLOSED");
    expect(closed.status).toBe("CLOSED");
    const reopened = await setSupportTicketStatus(db, ticket.id, "OPEN");
    expect(reopened.status).toBe("OPEN");
  });
});
