import { NextResponse } from "next/server";
import { getSessionWorkspace, requireRole, type RoleValue, type SessionContext } from "@/lib/auth/session";
import { logger } from "@/lib/log";

/**
 * Shared helpers for product API routes. Every handler starts by
 * resolving the session workspace; the workspace id from that context is
 * the tenant isolation boundary for every query that follows.
 */

export async function requireSession(
  minimum: RoleValue = "VIEWER",
): Promise<{ ctx: SessionContext } | { error: NextResponse }> {
  const ctx = await getSessionWorkspace();
  if (!ctx) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  try {
    requireRole(ctx, minimum);
  } catch {
    return {
      error: NextResponse.json(
        { error: `This action requires the ${minimum} role` },
        { status: 403 },
      ),
    };
  }
  return { ctx };
}

export function apiError(error: unknown): NextResponse {
  if (error instanceof Error) {
    const status = (error as Error & { status?: number }).status;
    if (typeof status === "number") {
      return NextResponse.json({ error: error.message }, { status });
    }
    logger.error("API error", { error });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  logger.error("API error", { error });
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

/** Parses a JSON request body, returning null when it is not valid JSON. */
export async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

export function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function intField(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}
