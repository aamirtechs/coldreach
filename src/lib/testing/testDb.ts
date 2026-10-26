import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

/**
 * Test database support.
 *
 * Each integration test file gets its own SQLite database, migrated from
 * the committed migrations with the real Prisma schema engine, so tests
 * exercise the exact schema production uses. Engine binaries are located
 * under node_modules/@prisma/engines (see the README troubleshooting
 * section for why they are pre-downloaded on this machine).
 */

const PROJECT_ROOT = process.cwd();

function engineEnv(): Record<string, string> {
  const enginesDir = path.join(PROJECT_ROOT, "node_modules", "@prisma", "engines");
  const files = fs.existsSync(enginesDir) ? fs.readdirSync(enginesDir) : [];
  const env: Record<string, string> = {};
  const schemaEngine = files.find((f) => f.startsWith("schema-engine-"));
  const queryEngine = files.find((f) => f.startsWith("libquery_engine-"));
  if (schemaEngine) {
    env.PRISMA_SCHEMA_ENGINE_BINARY = path.join(enginesDir, schemaEngine);
  }
  if (queryEngine) {
    env.PRISMA_QUERY_ENGINE_LIBRARY = path.join(enginesDir, queryEngine);
  }
  return env;
}

export function freshTestDb(name: string): PrismaClient {
  const dbFile = path.join(PROJECT_ROOT, "prisma", `${name}.db`);
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    const candidate = `${dbFile}${suffix}`;
    if (fs.existsSync(candidate)) {
      fs.rmSync(candidate);
    }
  }
  const url = `file:./${name}.db`;
  execFileSync(path.join(PROJECT_ROOT, "node_modules", ".bin", "prisma"), ["migrate", "deploy"], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, ...engineEnv(), DATABASE_URL: url },
    stdio: "pipe",
  });
  return new PrismaClient({ datasources: { db: { url } } });
}

export async function dropTestDb(db: PrismaClient, name: string): Promise<void> {
  await db.$disconnect();
  const dbFile = path.join(PROJECT_ROOT, "prisma", `${name}.db`);
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    const candidate = `${dbFile}${suffix}`;
    if (fs.existsSync(candidate)) {
      fs.rmSync(candidate);
    }
  }
}

/** Seeds a workspace with sender identity configured, owned by a user. */
export async function seedWorkspace(db: PrismaClient, slugSuffix: string) {
  const user = await db.user.create({
    data: {
      name: "Test Owner",
      email: `owner-${slugSuffix}@example.com`,
      passwordHash: "not-a-real-hash",
    },
  });
  const workspace = await db.workspace.create({
    data: {
      name: "Test Workspace",
      slug: `test-${slugSuffix}`,
      senderName: "Test Sender",
      senderAddress: "1 Test Street, Testville",
    },
  });
  await db.membership.create({
    data: { userId: user.id, workspaceId: workspace.id, role: "OWNER" },
  });
  return { user, workspace };
}
