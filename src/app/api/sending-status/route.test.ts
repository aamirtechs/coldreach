import { describe, expect, it, vi } from "vitest";

/**
 * Sidebar sending status route. Session, Prisma, and the schedule
 * service are mocked in the same style as the accounts route test; the
 * schedule fixture is the dashboard panel's source, so the test proves
 * the route passes its figures through unchanged.
 */

const mocks = vi.hoisted(() => ({
  prisma: {
    sendingAccount: {
      findMany: vi.fn(async () => [
        { email: "a@example.com", status: "CONNECTED" },
        { email: "b@example.com", status: "DISCONNECTED" },
      ]),
    },
  },
  getSendingSchedule: vi.fn(async () => ({
    lastSentAt: new Date("2026-10-29T06:00:00Z"),
    sentToday: 228,
    capacity: { used: 228, cap: 228, accounts: 19 },
    upcoming: [],
  })),
  requireSession: vi.fn(async () => ({
    ctx: {
      user: { id: "user-1" },
      workspace: { id: "ws-1" },
      role: "OWNER",
    },
  })),
}));

vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));

vi.mock("@/lib/sendingSchedule", () => ({ getSendingSchedule: mocks.getSendingSchedule }));

vi.mock("@/lib/api", () => ({
  requireSession: mocks.requireSession,
  apiError: (error: unknown) =>
    new Response(JSON.stringify({ error: error instanceof Error ? error.message : "error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    }),
}));

import { GET } from "./route";

describe("GET /api/sending-status", () => {
  it("returns schedule figures and the account status list", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      sentToday: number;
      capacityCap: number;
      capacityUsed: number;
      lastSentAt: string;
      accounts: Array<{ email: string; status: string }>;
    };
    expect(payload.sentToday).toBe(228);
    expect(payload.capacityUsed).toBe(228);
    expect(payload.capacityCap).toBe(228);
    expect(payload.lastSentAt).toBe("2026-10-29T06:00:00.000Z");
    expect(payload.accounts).toEqual([
      { email: "a@example.com", status: "CONNECTED" },
      { email: "b@example.com", status: "DISCONNECTED" },
    ]);
    expect(mocks.getSendingSchedule).toHaveBeenCalledWith(mocks.prisma, "ws-1");
  });
});
