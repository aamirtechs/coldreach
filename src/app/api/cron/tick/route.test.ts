import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dropTestDb, freshTestDb } from "@/lib/testing/testDb";
import type { PrismaClient } from "@prisma/client";

/**
 * Cron route auth. The route module reads CRON_SECRET through the
 * authorization helper at request time and the global Prisma client
 * from DATABASE_URL, so both are set before the module is imported.
 * The 200 path runs a real (empty) tick against a migrated test
 * database: no campaigns exist, so nothing sends.
 */

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
  it("answers 401 without the secret", async () => {
    const response = await GET(new Request("http://localhost/api/cron/tick"));
    expect(response.status).toBe(401);
  });

  it("answers 401 with the wrong secret", async () => {
    const response = await GET(
      new Request("http://localhost/api/cron/tick", {
        headers: { authorization: "Bearer wrong-secret" },
      }),
    );
    expect(response.status).toBe(401);
  });

  it("runs the tick and answers 200 with the bearer secret", async () => {
    const response = await GET(
      new Request("http://localhost/api/cron/tick", {
        headers: { authorization: "Bearer cron-test-secret" },
      }),
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { ok: boolean; sent: number };
    expect(payload.ok).toBe(true);
    expect(payload.sent).toBe(0);
  });
});
