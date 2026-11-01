/**
 * Product (transactional) email, v1.14.0.
 *
 * ColdReach's own mail: signup verification today, password resets
 * and product notices later. Sent through Resend's API (free tier:
 * 3,000 emails a month, 100 a day, which is far beyond signup
 * volume) when RESEND_API_KEY is configured. This is deliberately
 * separate from campaign sending, which runs on each workspace's
 * own mailboxes and requires opted-in recipient tooling Resend does
 * not provide.
 *
 * Configuration (Vercel environment):
 * - RESEND_API_KEY: the sending key. Unset means product mail is
 *   off, and email verification is not enforced (see
 *   src/lib/auth/emailVerification.ts).
 * - PRODUCT_MAIL_FROM: the From address, on the domain verified in
 *   Resend. Defaults to "ColdReach <no-reply@aamirtechs.com>".
 */

export interface ProductMailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface ProductMailResult {
  sent: boolean;
  /** Provider message id when the send was accepted. */
  id?: string;
  /** Short machine-readable reason when not sent. */
  reason?: string;
}

export type ProductMailFetch = (url: string, init: RequestInit) => Promise<Response>;
type FetchImpl = ProductMailFetch;

export function isProductMailConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.RESEND_API_KEY?.trim());
}

export function productMailFrom(env: NodeJS.ProcessEnv = process.env): string {
  return env.PRODUCT_MAIL_FROM?.trim() || "ColdReach <no-reply@aamirtechs.com>";
}

export async function sendProductEmail(
  input: ProductMailInput,
  deps: { env?: NodeJS.ProcessEnv; fetchImpl?: FetchImpl } = {},
): Promise<ProductMailResult> {
  const env = deps.env ?? process.env;
  const apiKey = env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    return { sent: false, reason: "not_configured" };
  }
  const fetchImpl = deps.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: productMailFrom(env),
        to: [input.to],
        subject: input.subject,
        text: input.text,
        ...(input.html ? { html: input.html } : {}),
      }),
    });
    if (!response.ok) {
      return { sent: false, reason: `provider_${response.status}` };
    }
    const data = (await response.json().catch(() => ({}))) as { id?: string };
    return { sent: true, id: data.id };
  } catch {
    return { sent: false, reason: "provider_unreachable" };
  }
}
