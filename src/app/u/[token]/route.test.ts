import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { dropTestDb, freshTestDb, seedWorkspace } from "@/lib/testing/testDb";
import { createUnsubscribeToken } from "@/lib/worker/unsubscribe";

/**
 * RFC 8058 one-click unsubscribe POST handler. The route module uses
 * the global Prisma client, so DATABASE_URL points at the migrated
 * test database before the module is imported, mirroring the cron
 * route test. The handler must answer JSON only, 200 for a valid
 * token (repeat posts included), and 400 for an invalid one.
 */

const DB_NAME = "test-oneclick";
let db: PrismaClient;
let POST: (
  request: Request,
  context: { params: Promise<{ token: string }> },
) => Promise<Response>;
let workspaceId: string;
let leadId: string;
let enrollmentId: string;

function postTo(token: string): Promise<Response> {
  return POST(new Request(`http://localhost/u/${token}`, { method: "POST" }), {
    params: Promise.resolve({ token }),
  });
}

beforeAll(async () => {
  process.env.DATABASE_URL = `file:./${DB_NAME}.db`;
  db = freshTestDb(DB_NAME);
  const seeded = await seedWorkspace(db, "oneclick");
  workspaceId = seeded.workspace.id;

  const list = await db.leadList.create({ data: { workspaceId, name: "One-click list" } });
  const lead = await db.lead.create({
    data: {
      workspaceId,
      listId: list.id,
      email: "oneclick@example.com",
      fields: {},
      tags: [],
      status: "NEW",
    },
  });
  leadId = lead.id;
  const campaign = await db.campaign.create({
    data: { workspaceId, name: "One-click campaign", status: "RUNNING", leadListId: list.id },
  });
  const enrollment = await db.enrollment.create({
    data: {
      campaignId: campaign.id,
      leadId: lead.id,
      status: "ACTIVE",
      nextSendAt: new Date(Date.now() + 3600_000),
    },
  });
  enrollmentId = enrollment.id;

  const route = await import("./route");
  POST = route.POST as never;
}, 120_000);

afterAll(async () => {
  await dropTestDb(db, DB_NAME);
});

describe("POST /u/[token] one-click unsubscribe", () => {
  it("answers 400 for an invalid token and changes nothing", async () => {
    const response = await postTo("not-a-valid-token");
    expect(response.status).toBe(400);
    const lead = await db.lead.findUnique({ where: { id: leadId } });
    expect(lead?.status).toBe("NEW");
    expect(await db.suppression.count({ where: { workspaceId } })).toBe(0);
  });

  it("answers 400 for a tampered token", async () => {
    const token = createUnsubscribeToken(workspaceId, leadId);
    const response = await postTo(`${token.slice(0, -2)}xx`);
    expect(response.status).toBe(400);
    const lead = await db.lead.findUnique({ where: { id: leadId } });
    expect(lead?.status).toBe("NEW");
  });

  it("applies the unsubscribe and answers 200 with JSON, not a page", async () => {
    const token = createUnsubscribeToken(workspaceId, leadId);
    const response = await postTo(token);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    const payload = (await response.json()) as { ok: boolean };
    expect(payload.ok).toBe(true);

    const lead = await db.lead.findUnique({ where: { id: leadId } });
    expect(lead?.status).toBe("UNSUBSCRIBED");
    const enrollment = await db.enrollment.findUnique({ where: { id: enrollmentId } });
    expect(enrollment?.status).toBe("UNSUBSCRIBED");
    expect(
      await db.suppression.count({
        where: { workspaceId, email: "oneclick@example.com" },
      }),
    ).toBe(1);
    expect(
      await db.emailEvent.count({ where: { workspaceId, type: "UNSUBSCRIBED" } }),
    ).toBe(1);
  });

  it("is idempotent: a second POST also answers 200 and changes nothing more", async () => {
    const token = createUnsubscribeToken(workspaceId, leadId);
    const response = await postTo(token);
    expect(response.status).toBe(200);
    expect(
      await db.suppression.count({
        where: { workspaceId, email: "oneclick@example.com" },
      }),
    ).toBe(1);
    expect(
      await db.emailEvent.count({ where: { workspaceId, type: "UNSUBSCRIBED" } }),
    ).toBe(1);
  });
});
