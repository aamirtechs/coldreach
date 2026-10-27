import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import type { MailboxCredentials } from "@/lib/providers/smtp";

/**
 * Live connection checks for user entered mailbox settings.
 *
 * The verify calls sit behind the MailboxConnectionVerifier
 * interface so route tests can substitute a fake; the real
 * implementation opens an SMTP session (transport.verify) and an
 * IMAP login with an INBOX open, then closes both. Errors are
 * translated into short friendly messages. The raw provider error
 * and the password are never logged or returned.
 */

export interface ConnectionCheckResult {
  ok: boolean;
  error?: string;
}

export interface MailboxConnectionResults {
  smtp: ConnectionCheckResult;
  imap: ConnectionCheckResult;
}

export interface MailboxConnectionVerifier {
  verifySmtp(credentials: MailboxCredentials): Promise<void>;
  verifyImap(credentials: MailboxCredentials): Promise<void>;
}

const TIMEOUT_MS = 15_000;

export const mailboxConnectionVerifier: MailboxConnectionVerifier = {
  async verifySmtp(credentials) {
    const transport = nodemailer.createTransport({
      host: credentials.smtp.host,
      port: credentials.smtp.port,
      secure: credentials.smtp.secure,
      auth: { user: credentials.user, pass: credentials.pass },
      ...(credentials.smtp.secure ? {} : { requireTLS: true }),
      connectionTimeout: TIMEOUT_MS,
      greetingTimeout: TIMEOUT_MS,
      socketTimeout: TIMEOUT_MS,
    });
    try {
      await transport.verify();
    } finally {
      transport.close();
    }
  },

  async verifyImap(credentials) {
    if (!credentials.imap) {
      throw new Error("IMAP is not configured for this mailbox.");
    }
    const client = new ImapFlow({
      host: credentials.imap.host,
      port: credentials.imap.port,
      secure: credentials.imap.secure,
      auth: { user: credentials.user, pass: credentials.pass },
      logger: false,
      disableAutoIdle: true,
      connectionTimeout: TIMEOUT_MS,
      greetingTimeout: TIMEOUT_MS,
      socketTimeout: TIMEOUT_MS,
      ...(credentials.imap.secure ? {} : { doSTARTTLS: true as const }),
    });
    await client.connect();
    try {
      const lock = await client.getMailboxLock("INBOX");
      lock.release();
    } finally {
      await client.logout().catch(() => undefined);
    }
  },
};

/** Maps a raw connection failure to a short, safe explanation. */
export function friendlyMailboxConnectionError(error: unknown): string {
  const candidate = error as { code?: unknown; message?: unknown } | null;
  const code = typeof candidate?.code === "string" ? candidate.code : "";
  const message = error instanceof Error ? error.message : String(error ?? "");
  const haystack = `${code} ${message}`.toLowerCase();
  if (
    haystack.includes("authenticationfailed") ||
    haystack.includes("eauth") ||
    haystack.includes("invalid credentials") ||
    haystack.includes("login failed") ||
    haystack.includes("authentication failed")
  ) {
    return "Authentication failed. Check the username and password.";
  }
  if (
    haystack.includes("enotfound") ||
    haystack.includes("eai_again") ||
    haystack.includes("getaddrinfo")
  ) {
    return "Host unreachable. Check the server name.";
  }
  if (
    haystack.includes("etimedout") ||
    haystack.includes("etimeout") ||
    haystack.includes("timed out") ||
    haystack.includes("timeout")
  ) {
    return "Host unreachable or timed out. Check the server name and port.";
  }
  if (
    haystack.includes("cert") ||
    haystack.includes("self_signed") ||
    haystack.includes("self-signed") ||
    haystack.includes("unable_to_verify") ||
    haystack.includes("unable to verify") ||
    haystack.includes("tls")
  ) {
    return "TLS or certificate problem. Check the security setting and that the server name matches its certificate.";
  }
  if (haystack.includes("econnrefused") || haystack.includes("connection refused")) {
    return "Port closed or connection refused. Check the port and security setting.";
  }
  if (haystack.includes("not configured")) {
    return "IMAP is not configured for this mailbox.";
  }
  return "Connection failed. Check the server, port, and security settings.";
}

async function runCheck(check: () => Promise<void>): Promise<ConnectionCheckResult> {
  try {
    await check();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: friendlyMailboxConnectionError(error) };
  }
}

/**
 * Runs both protocol checks independently: a working SMTP with a
 * broken IMAP (or the reverse) reports each side truthfully.
 */
export async function testMailboxConnection(
  credentials: MailboxCredentials,
  verifier: MailboxConnectionVerifier = mailboxConnectionVerifier,
): Promise<MailboxConnectionResults> {
  const [smtp, imap] = await Promise.all([
    runCheck(() => verifier.verifySmtp(credentials)),
    credentials.imap
      ? runCheck(() => verifier.verifyImap(credentials))
      : Promise.resolve<ConnectionCheckResult>({
          ok: false,
          error: "IMAP is not configured for this mailbox.",
        }),
  ]);
  return { smtp, imap };
}
