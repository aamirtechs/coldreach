import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { applyUnsubscribe, verifyUnsubscribeToken } from "@/lib/worker/unsubscribe";

/**
 * Public unsubscribe endpoint. No login: the signed HMAC token in
 * the link is the credential, and applying it is immediate and
 * idempotent.
 *
 * GET renders the human confirmation page (this segment serves it
 * from the route handler, with self contained styling in the app's
 * design tokens, because Next.js does not allow a page and a route
 * handler in the same segment). POST is the RFC 8058 one-click
 * endpoint: mail clients such as Gmail and Yahoo POST here directly
 * from the List-Unsubscribe-Post header without opening the page,
 * so it answers JSON only, 200 for a valid token (repeat posts
 * included), and 400 for an invalid one.
 */

export const dynamic = "force-dynamic";

function unsubscribePage(applied: boolean, message: string): NextResponse {
  const extra = applied
    ? `<p class="extra">The address has also been added to the sender's suppression list, so it cannot be re-imported into future campaigns in that workspace by accident.</p>`
    : "";
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${applied ? "Unsubscribed" : "Unsubscribe"} · ColdReach</title>
<style>
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; background: rgb(248 250 252); color: rgb(15 23 42); font-family: ui-sans-system, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; padding: 0 1rem; }
  .card { background: rgb(255 255 255); border: 1px solid rgb(226 232 240); border-radius: 0.75rem; max-width: 28rem; width: 100%; padding: 2rem; text-align: center; box-shadow: 0 1px 2px rgb(15 23 42 / 0.05); }
  h1 { font-size: 1.25rem; font-weight: 600; margin: 0; }
  p { font-size: 0.875rem; line-height: 1.625; color: rgb(100 116 139); margin: 0.75rem 0 0; }
  .extra { font-size: 0.75rem; margin-top: 1rem; }
</style>
</head>
<body>
<main class="card">
  <h1>${applied ? "Unsubscribed" : "Unsubscribe"}</h1>
  <p>${message}</p>
  ${extra}
</main>
</body>
</html>`;
  return new NextResponse(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const claims = verifyUnsubscribeToken(token);

  let message = "This unsubscribe link is invalid or has expired.";
  let applied = false;
  if (claims) {
    const result = await applyUnsubscribe(prisma, claims);
    if (result.applied) {
      applied = true;
      message =
        "You have been unsubscribed. You will not receive further emails from this sender through ColdReach.";
    }
  }
  return unsubscribePage(applied, message);
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const claims = verifyUnsubscribeToken(token);
  if (!claims) {
    return NextResponse.json({ error: "Invalid unsubscribe token" }, { status: 400 });
  }
  const result = await applyUnsubscribe(prisma, claims);
  if (!result.applied) {
    return NextResponse.json({ error: "Invalid unsubscribe token" }, { status: 400 });
  }
  return NextResponse.json({ ok: true }, { status: 200 });
}
