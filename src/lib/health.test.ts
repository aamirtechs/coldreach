import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { dropTestDb, freshTestDb } from "@/lib/testing/testDb";
import { checkHealth } from "./health";
import packageJson from "../../package.json";

const DB_NAME = "test-health";
let db: PrismaClient;

beforeAll(() => {
  db = freshTestDb(DB_NAME);
});

afterAll(async () => {
  await dropTestDb(db, DB_NAME);
});

describe("checkHealth", () => {
  it("reports ok with version and time when the database answers", async () => {
    const report = await checkHealth(db);
    expect(report.status).toBe("ok");
    expect(report.db).toBe("ok");
    expect(report.version).toBe(packageJson.version);
    expect(() => new Date(report.time).toISOString()).not.toThrow();
  });

  it("reports error (and leaks no detail) when the database fails", async () => {
    const broken = {
      $queryRaw: async () => {
        throw new Error("connection refused at 10.0.0.5:5432 password=hunter2");
      },
    } as unknown as PrismaClient;
    const report = await checkHealth(broken);
    expect(report.status).toBe("error");
    expect(report.db).toBe("error");
    expect(JSON.stringify(report)).not.toContain("hunter2");
    expect(JSON.stringify(report)).not.toContain("10.0.0.5");
  });
});
