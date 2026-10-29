import { describe, expect, it, vi } from "vitest";

/**
 * Reclassify-automated route: only REFERRAL, NEUTRAL, and
 * unclassified threads are scanned, only detector matches move to
 * AUTOMATED, and matching REPLIED events follow the thread.
 */

const mocks = vi.hoisted(() => ({
  prisma: {
    thread: {
      findMany: vi.fn(),
      update: vi.fn(async (_args: { where: { id: string } }) => ({})),
    },
    emailEvent: { updateMany: vi.fn(async () => ({ count: 1 })) },
  },
  requireSession: vi.fn(async () => ({
    ctx: { user: { id: "user-1" }, workspace: { id: "ws-1" }, role: "OWNER" },
  })),
  writeAuditLog: vi.fn(async () => undefined),
}));

vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, requireSession: mocks.requireSession };
});
vi.mock("@/lib/audit", () => ({ writeAuditLog: mocks.writeAuditLog }));

import { POST } from "./route";

const WATI_BODY =
  "Hi there, Thanks for reaching out. For the fastest help, please use the in-app help widget " +
  "or chat with our AI assistant. You can also browse the help center for guides. Please do not " +
  "send an email to support@wati.io or billing@wati.io, as those inboxes are not monitored for " +
  "support requests. Warm regards, The Wati Team";

function thread(id: string, classification: string | null, fromEmail: string, body: string) {
  return {
    id,
    leadId: `lead-${id}`,
    classification,
    messages: [{ fromEmail, subject: "Re: Help", body }],
  };
}

describe("POST /api/threads/reclassify-automated", () => {
  it("scans only REFERRAL, NEUTRAL, and unclassified threads", async () => {
    mocks.prisma.thread.findMany.mockResolvedValue([]);
    const response = await POST();
    expect(response.status).toBe(200);
    const where = (
      mocks.prisma.thread.findMany.mock.calls[0]?.[0] as { where: { OR: unknown } }
    ).where;
    expect(where.OR).toEqual([
      { classification: "REFERRAL" },
      { classification: "NEUTRAL" },
      { classification: null },
    ]);
  });

  it("reclassifies detector matches and leaves human threads alone", async () => {
    mocks.prisma.thread.findMany.mockResolvedValue([
      thread("t-1", "REFERRAL", "support@wati.io", WATI_BODY),
      thread("t-2", "NEUTRAL", "sam@poochandmutt.example", "Thanks, looping in our vet tech Sara to help."),
      thread("t-3", null, "tickets@vendor.example", "We received your request. Ticket #4821 has been created."),
    ]);
    const response = await POST();
    const data = await response.json();
    expect(data).toEqual({ scanned: 3, reclassified: 2 });
    const updatedIds = mocks.prisma.thread.update.mock.calls.map((call) => call[0].where.id);
    expect(updatedIds).toEqual(["t-1", "t-3"]);
    expect(mocks.prisma.emailEvent.updateMany).toHaveBeenCalledTimes(2);
  });
});
