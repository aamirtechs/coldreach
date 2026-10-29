import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { recordClick, verifyClickToken } from "@/lib/worker/clickTracking";

/**
 * Click tracking redirect.
 *
 * Verifies the signed token from a rewritten campaign link,
 * records the click, and redirects the reader to the target URL
 * carried inside the token. An invalid token gets a plain 400
 * and is never redirected anywhere: the target only ever comes
 * from a verified token, so this endpoint cannot be turned into
 * an open redirector. Recording failures are swallowed like the
 * open tracking pixel does, because a lost click is a soft
 * metric and a broken link for the reader is not.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const claims = verifyClickToken(token);
  if (!claims) {
    return new Response("Invalid click tracking link", { status: 400 });
  }
  try {
    await recordClick(prisma, claims);
  } catch {
    // Redirect regardless; see the note above.
  }
  return NextResponse.redirect(claims.targetUrl, 302);
}
