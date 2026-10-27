import type { PrismaClient } from "@prisma/client";
import packageJson from "../../package.json";

/**
 * Liveness and readiness probe behind GET /api/health.
 *
 * The check is deliberately shallow: one SELECT 1 against the
 * database. It answers "can this instance serve traffic" for an
 * uptime monitor, nothing more. It exposes no configuration, no
 * counts, and no error detail: a failed check reports db: "error"
 * and the monitor sees a 503.
 */

export interface HealthReport {
  status: "ok" | "error";
  db: "ok" | "error";
  version: string;
  time: string;
}

export async function checkHealth(db: PrismaClient): Promise<HealthReport> {
  let dbStatus: "ok" | "error" = "ok";
  try {
    await db.$queryRaw`SELECT 1`;
  } catch {
    dbStatus = "error";
  }
  return {
    status: dbStatus === "ok" ? "ok" : "error",
    db: dbStatus,
    version: packageJson.version,
    time: new Date().toISOString(),
  };
}
