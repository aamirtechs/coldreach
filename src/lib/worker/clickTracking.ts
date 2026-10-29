import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

/**
 * Click tracking.
 *
 * Campaign email links are rewritten to point at the /c/[token]
 * endpoint, which verifies a signed token naming the workspace,
 * enrollment, step and target URL, records one CLICKED event per
 * enrollment, step and target URL, and then redirects the reader
 * to the target. Recording is keyed
 * evt:<enrollmentId>:<stepIndex>:CLICKED:<url hash>, so repeat
 * clicks on the same link never inflate the count, while clicks
 * on different links in the same email count separately.
 *
 * The token mirrors the open tracking token: an HMAC under
 * SESSION_SECRET with a "click" payload prefix, so it cannot be
 * forged for another enrollment and can never collide with an
 * open or unsubscribe token. The target URL travels inside the
 * signed payload as a final base64url segment, because a raw URL
 * can contain dots and other characters that would break the
 * dot separated payload shape. Verification only accepts http
 * and https targets, so a token can never be used to redirect
 * a reader to a javascript or other non-web URL.
 */

function hmacSecret(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("SESSION_SECRET is missing or too short");
  }
  return Buffer.from(secret, "utf8");
}

function sign(payload: string): string {
  return createHmac("sha256", hmacSecret()).update(payload).digest("base64url");
}

export function createClickToken(
  workspaceId: string,
  enrollmentId: string,
  stepIndex: number,
  targetUrl: string,
): string {
  const encodedTarget = Buffer.from(targetUrl, "utf8").toString("base64url");
  const payload = `click.${workspaceId}.${enrollmentId}.${stepIndex}.${encodedTarget}`;
  return `${Buffer.from(payload, "utf8").toString("base64url")}.${sign(payload)}`;
}

export interface ClickClaims {
  workspaceId: string;
  enrollmentId: string;
  stepIndex: number;
  targetUrl: string;
}

export function verifyClickToken(token: string): ClickClaims | null {
  const parts = token.split(".");
  if (parts.length !== 2) {
    return null;
  }
  let payload: string;
  try {
    payload = Buffer.from(parts[0], "base64url").toString("utf8");
  } catch {
    return null;
  }
  const expected = Buffer.from(sign(payload), "utf8");
  const provided = Buffer.from(parts[1], "utf8");
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    return null;
  }
  const segments = payload.split(".");
  if (segments.length !== 5 || segments[0] !== "click" || !segments[1] || !segments[2] || !segments[4]) {
    return null;
  }
  const stepIndex = Number(segments[3]);
  if (!Number.isInteger(stepIndex) || stepIndex < 0) {
    return null;
  }
  let targetUrl: string;
  try {
    targetUrl = Buffer.from(segments[4], "base64url").toString("utf8");
  } catch {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }
  return { workspaceId: segments[1], enrollmentId: segments[2], stepIndex, targetUrl };
}

/**
 * The base URL tracking links are built on. A workspace with a
 * custom tracking domain gets https URLs on that host; every
 * other workspace uses the app URL. Shared by open and click
 * tracking so both pixel and link URLs follow the same rule.
 */
export function resolveTrackingBase(
  workspace: { trackingDomain?: string | null },
  appUrl: string,
): string {
  const trackingDomain = workspace.trackingDomain?.trim().replace(/\/$/, "");
  if (trackingDomain) {
    return `https://${trackingDomain}`;
  }
  return appUrl.replace(/\/$/, "");
}

export interface RecordClickResult {
  recorded: boolean;
  duplicate: boolean;
}

function clickIdempotencyKey(enrollmentId: string, stepIndex: number, targetUrl: string): string {
  const urlHash = createHash("sha256").update(targetUrl).digest("hex").slice(0, 16);
  return `evt:${enrollmentId}:${stepIndex}:CLICKED:${urlHash}`;
}

/**
 * Records the first CLICKED event for an enrollment, step and
 * target URL. Attribution (campaign, sending account, A/B
 * variant) is copied from the enrollment's most recent SENT
 * event, the same fallback recordOpen uses.
 */
export async function recordClick(db: PrismaClient, claims: ClickClaims): Promise<RecordClickResult> {
  const enrollment = await db.enrollment.findUnique({
    where: { id: claims.enrollmentId },
    include: { campaign: { select: { id: true, workspaceId: true } } },
  });
  if (!enrollment || enrollment.campaign.workspaceId !== claims.workspaceId) {
    return { recorded: false, duplicate: false };
  }

  const idempotencyKey = clickIdempotencyKey(claims.enrollmentId, claims.stepIndex, claims.targetUrl);
  const existing = await db.emailEvent.findUnique({
    where: { idempotencyKey },
    select: { id: true },
  });
  if (existing) {
    return { recorded: false, duplicate: true };
  }

  const sent = await db.emailEvent.findFirst({
    where: { enrollmentId: claims.enrollmentId, type: "SENT" },
    select: { sendingAccountId: true, variant: true },
    orderBy: { createdAt: "desc" },
  });

  await db.emailEvent.create({
    data: {
      workspaceId: claims.workspaceId,
      campaignId: enrollment.campaignId,
      enrollmentId: claims.enrollmentId,
      sendingAccountId: sent?.sendingAccountId ?? null,
      type: "CLICKED",
      idempotencyKey,
      variant: sent?.variant ?? null,
      occurredAt: new Date(),
    },
  });
  return { recorded: true, duplicate: false };
}

const HREF_PATTERN = /(<a\b[^>]*?\bhref\s*=\s*)("([^"]*)"|'([^']*)')/gi;

/**
 * Rewrite the anchor hrefs of an HTML email part to click tracking
 * URLs on the tracking base (v1.11.0). Deliberately conservative:
 * - the unsubscribe URL is never rewritten (it must keep working
 *   even if tracking breaks, and it is a compliance link);
 * - mailto, tel, and in-page anchors are left alone;
 * - URLs already on the tracking host are left alone, which covers
 *   the open tracking pixel host as well (the pixel is an img, not
 *   an anchor, so it never matches anyway);
 * - only absolute http and https targets are rewritten.
 * The plain text part is never passed through here.
 */
export function rewriteLinksForTracking(
  html: string,
  args: {
    trackingBase: string;
    workspaceId: string;
    enrollmentId: string;
    stepIndex: number;
    unsubscribeUrl: string;
  },
): string {
  const base = args.trackingBase.replace(/\/$/, "");
  return html.replace(HREF_PATTERN, (match, prefix: string, quoted: string, dq?: string, sq?: string) => {
    const target = dq ?? sq ?? "";
    if (!target || target === args.unsubscribeUrl) {
      return match;
    }
    if (!/^https?:\/\//i.test(target)) {
      return match;
    }
    if (target === base || target.startsWith(`${base}/`)) {
      return match;
    }
    const token = createClickToken(args.workspaceId, args.enrollmentId, args.stepIndex, target);
    const quote = quoted.startsWith("'") ? "'" : '"';
    return `${prefix}${quote}${base}/c/${token}${quote}`;
  });
}
