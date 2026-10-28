import { prisma } from "@/lib/prisma";
import { recordOpen, verifyOpenToken } from "@/lib/worker/openTracking";

/**
 * Open-tracking pixel (v1.9.0).
 *
 * Always answers with the same 1x1 transparent GIF, whether the
 * token is valid, already recorded, or garbage: an email client
 * must never see a broken image, and the response must reveal
 * nothing about token validity. Recording failures are swallowed
 * for the same reason; a lost open is a soft metric, a broken
 * email is not.
 */
const PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const claims = verifyOpenToken(token);
  if (claims) {
    try {
      await recordOpen(prisma, claims);
    } catch {
      // Serve the pixel regardless; see the note above.
    }
  }
  return new Response(new Uint8Array(PIXEL), {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      "Content-Length": String(PIXEL.length),
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    },
  });
}
