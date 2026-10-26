import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { getAgencyRollup } from "./rollup";
import { dropTestDb, freshTestDb, seedWorkspace } from "@/lib/testing/testDb";

const DB_NAME = "test-agency";
let db: PrismaClient;
let ownerId: string;
let wsA: string;
let wsB: string;

async function seedEvents(
  workspaceId: string,
  counts: { SENT: number; REPLIED: number; BOUNCED: number },
  keyPrefix: string,
): Promise<void> {
  const rows: { workspaceId: string; type: "SENT" | "REPLIED" | "BOUNCED"; idempotencyKey: string; occurredAt: Date }[] = [];
  let index = 0;
  for (const [type, count] of Object.entries(counts)) {
    for (let i = 0; i < count; i += 1) {
      index += 1;
      rows.push({
        workspaceId,
        type: type as "SENT" | "REPLIED" | "BOUNCED",
        idempotencyKey: `${keyPrefix}:${index}`,
        occurredAt: new Date(),
      });
    }
  }
  await db.emailEvent.createMany({ data: rows });
}

beforeAll(async () => {
  db = freshTestDb(DB_NAME);
  const seeded = await seedWorkspace(db, "agency-a");
  ownerId = seeded.user.id;
  wsA = seeded.workspace.id;

  const workspaceB = await db.workspace.create({
    data: { name: "Client B", slug: "agency-b", senderName: "B", senderAddress: "2 Street" },
  });
  wsB = workspaceB.id;
  await db.membership.create({ data: { userId: ownerId, workspaceId: wsB, role: "OWNER" } });

  // A third workspace the user belongs to but does NOT own.
  const other = await seedWorkspace(db, "agency-other");
  await db.membership.create({
    data: { userId: ownerId, workspaceId: other.workspace.id, role: "MEMBER" },
  });

  await seedEvents(wsA, { SENT: 100, REPLIED: 12, BOUNCED: 8 }, "a");
  await seedEvents(wsB, { SENT: 50, REPLIED: 5, BOUNCED: 1 }, "b");
  await seedEvents(other.workspace.id, { SENT: 999, REPLIED: 99, BOUNCED: 99 }, "other");

  await db.campaign.create({
    data: { workspaceId: wsA, name: "Running one", status: "RUNNING" },
  });
  await db.campaign.create({
    data: { workspaceId: wsB, name: "Paused one", status: "PAUSED" },
  });
  await db.sendingAccount.create({
    data: {
      workspaceId: wsB,
      email: "broken@example.com",
      provider: "SIMULATION",
      status: "ERROR",
      credentialRef: null,
    },
  });
});

afterAll(async () => {
  await dropTestDb(db, DB_NAME);
});

describe("getAgencyRollup", () => {
  it("aggregates only owned workspaces and totals them", async () => {
    const rollup = await getAgencyRollup(db, ownerId);
    expect(rollup.workspaces.map((row) => row.workspaceId).sort()).toEqual([wsA, wsB].sort());
    expect(rollup.totals.sendsThisMonth).toBe(150);
    expect(rollup.totals.repliesThisMonth).toBe(17);
    expect(rollup.totals.bouncesThisMonth).toBe(9);
    expect(rollup.totals.activeCampaigns).toBe(1);
    expect(rollup.totals.accountsInError).toBe(1);
  });

  it("computes per-workspace rates and health flags", async () => {
    const rollup = await getAgencyRollup(db, ownerId);
    const a = rollup.workspaces.find((row) => row.workspaceId === wsA);
    const b = rollup.workspaces.find((row) => row.workspaceId === wsB);
    expect(a?.replyRate).toBeCloseTo(0.12);
    expect(a?.bounceRate).toBeCloseTo(0.08);
    // Workspace A breaches the 5 percent bounce flag line.
    expect(a?.flags.some((flag) => flag.includes("Bounce rate"))).toBe(true);
    expect(b?.bounceRate).toBeCloseTo(0.02);
    expect(b?.flags.some((flag) => flag.includes("ERROR"))).toBe(true);
    expect(b?.flags.some((flag) => flag.includes("Bounce rate"))).toBe(false);
  });

  it("returns an empty rollup for a user who owns nothing", async () => {
    const rollup = await getAgencyRollup(db, "no-such-user");
    expect(rollup.workspaces).toEqual([]);
    expect(rollup.totals.sendsThisMonth).toBe(0);
  });
});
