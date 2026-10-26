import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateApiKey, type ApiKeyContext, type ApiScope } from "./keys";

/**
 * Route helper for /api/v1, mirroring requireSession's shape for the
 * session API: handlers get either a key context or a ready-made
 * error response. The 429 path carries the Retry-After header the
 * limiter computed.
 */
export async function requireApiKey(
  request: Request,
  scope: ApiScope,
): Promise<{ ctx: ApiKeyContext } | { error: NextResponse }> {
  try {
    const ctx = await authenticateApiKey(prisma, request, scope);
    return { ctx };
  } catch (error) {
    const status = (error as { status?: number }).status ?? 500;
    const message = error instanceof Error ? error.message : "Internal server error";
    const response = NextResponse.json({ error: message }, { status });
    const retryAfter = (error as { retryAfterSeconds?: number }).retryAfterSeconds;
    if (status === 429 && typeof retryAfter === "number") {
      response.headers.set("Retry-After", String(retryAfter));
    }
    return { error: response };
  }
}
