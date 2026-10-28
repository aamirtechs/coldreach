import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { dropTestDb, freshTestDb } from "@/lib/testing/testDb";
import type { PrismaClient } from "@prisma/client";

/**
 * Cron route auth and fast acceptance. The route module reads
 * CRON_SECRET through the authorization helper at request time and
 * the global Prisma client from DATABASE_URL, so both are set before
 * the module is imported. Next's after() is mocked with a capturing
 * scheduler: an unauthorized request must schedule nothing, and an
 * authorized one must answer the acceptance immediately with exactly
 * one background task captured. Firing that task runs a real (empty)
 * tick against a migrated test database: no campaigns exist, so
 * nothing sends, and the task completing proves the background path
 * invokes the tick runner.
 */

const mocks = vi.hoisted(() => ({
  scheduled: [] as Array<() => Promise<void>>,
}));

vi.mock("next/server", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    after: (task: () => Promise<void>) => {
      mocks.scheduled.push(task);
    },
  };
});

const DB_NAME = "test-cron-route";
let db: PrismaClient;
let GET: (request: Request) => Promise<Response>;

beforeAll(async () => {
  process.env.CRON_SECRET = "cron-test-secret";
  process.env.DATABASE_URL = `file:./${DB_NAME}.db`;
  db = freshTestDb(DB_NAME);
  const route = await import("./route");
  GET = route.GET as never;
});

afterAll(async () => {
  await dropTestDb(db, DB_NAME);
  delete process.env.CRON_SECRET;
});

describe("GET /api/cron/tick", () => {
  it("answers 401 without the secret and schedules nothing", async () => {
    const response = await GET(new Request("http://localhost/api/cron/tick"));
    expect(response.status).toBe(401);
    expect(mocks.scheduled).toHaveLength(0);
  });

  it("answers 401 with the wrong secret and schedules nothing", async () => {
    const response = await GET(
      new Request("http://localhost/api/cron/tick", {
        headers: { authorization: "Bearer wrong-secret" },
      }),
    );
    expect(response.status).toBe(401);
    expect(mocks.scheduled).toHaveLength(0);
  });

  it("answers a fast acceptance with the bearer secret and schedules the tick in the background", async () => {
    const response = await GET(
      new Request("http://localhost/api/cron/tick", {
        headers: { authorization: "Bearer cron-test-secret" },
      }),
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { ok: boolean; accepted: boolean };
    expect(payload).toEqual({ ok: true, accepted: true });

    // The tick itself runs in the background: exactly one task was
    // scheduled, and firing it runs the (empty) tick to completion.
    expect(mocks.scheduled).toHaveLength(1);
    await expect(mocks.scheduled[0]()).resolves.toBeUndefined();
  });
});
