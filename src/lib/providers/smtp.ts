import nodemailer from "nodemailer";
import { decryptSecret, encryptSecret } from "@/lib/security/crypto";
import type { MailProvider, SendInput, SendResult } from "./types";

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  /**
   * When true the transport must upgrade with STARTTLS before it
   * authenticates. Set for user entered mailbox credentials on a
   * non implicit TLS port, so a password never crosses the wire in
   * cleartext. Legacy environment configs leave it unset and keep
   * nodemailer's default opportunistic behavior.
   */
  requireTls?: boolean;
}

export interface MailboxEndpoint {
  host: string;
  port: number;
  secure: boolean;
}

/**
 * Full mailbox credentials for one SMTP / IMAP mail server account,
 * the shape cPanel and other self hosted mailboxes need. The same
 * username and password authenticate both protocols. This is the
 * JSON document stored, AES-256-GCM encrypted, in
 * SendingAccount.encryptedCredentials for accounts whose owner typed
 * the password into the product. Plaintext never touches the
 * database, logs, or API responses.
 */
export interface MailboxCredentials {
  smtp: MailboxEndpoint;
  imap: MailboxEndpoint | null;
  user: string;
  pass: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validEndpoint(value: unknown): MailboxEndpoint | null {
  if (!isRecord(value)) {
    return null;
  }
  const { host, port, secure } = value;
  if (typeof host !== "string" || host.trim().length === 0) {
    return null;
  }
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) {
    return null;
  }
  if (typeof secure !== "boolean") {
    return null;
  }
  return { host: host.trim(), port, secure };
}

/** Validates an unknown value as MailboxCredentials, or returns null. */
export function validateMailboxCredentials(value: unknown): MailboxCredentials | null {
  if (!isRecord(value)) {
    return null;
  }
  const smtp = validEndpoint(value.smtp);
  if (!smtp) {
    return null;
  }
  let imap: MailboxEndpoint | null = null;
  if (value.imap !== null && value.imap !== undefined) {
    imap = validEndpoint(value.imap);
    if (!imap) {
      return null;
    }
  }
  if (typeof value.user !== "string" || value.user.trim().length === 0) {
    return null;
  }
  if (typeof value.pass !== "string" || value.pass.length === 0) {
    return null;
  }
  return { smtp, imap, user: value.user, pass: value.pass };
}

export function encryptMailboxCredentials(credentials: MailboxCredentials): string {
  const valid = validateMailboxCredentials(credentials);
  if (!valid) {
    throw new Error("Mailbox credentials are malformed and cannot be stored.");
  }
  return encryptSecret(JSON.stringify(valid));
}

export function decryptMailboxCredentials(payload: string): MailboxCredentials {
  let parsed: unknown;
  try {
    parsed = JSON.parse(decryptSecret(payload));
  } catch (error) {
    // decryptSecret failures (tampering, wrong key) keep their own
    // message; a JSON failure means the blob is not a mailbox blob.
    if (error instanceof Error && error.message.startsWith("Encrypted value")) {
      throw error;
    }
    throw new Error("Stored mailbox credentials are malformed. Re-enter the mailbox password.");
  }
  const valid = validateMailboxCredentials(parsed);
  if (!valid) {
    throw new Error("Stored mailbox credentials are malformed. Re-enter the mailbox password.");
  }
  return valid;
}

export function mailboxSmtpConfig(credentials: MailboxCredentials): SmtpConfig {
  return {
    ...credentials.smtp,
    user: credentials.user,
    pass: credentials.pass,
    requireTls: !credentials.smtp.secure,
  };
}

export function mailboxImapConfig(credentials: MailboxCredentials): SmtpConfig | null {
  if (!credentials.imap) {
    return null;
  }
  return {
    ...credentials.imap,
    user: credentials.user,
    pass: credentials.pass,
    requireTls: !credentials.imap.secure,
  };
}

function envPrefix(credentialRef: string): string {
  return credentialRef.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

/**
 * Resolves SMTP settings from the environment using the account's
 * credentialRef as a prefix. For a credentialRef of "ACME_SMTP" the
 * variables are ACME_SMTP_HOST, ACME_SMTP_PORT, ACME_SMTP_USER,
 * ACME_SMTP_PASS, and optional ACME_SMTP_SECURE ("true" or "false").
 *
 * This is the legacy path for operator managed accounts. User managed
 * mailboxes store encrypted credentials instead; see
 * resolveMailboxCredentials. Returns null when any required variable
 * is missing.
 */
export function resolveSmtpConfig(credentialRef: string | null | undefined): SmtpConfig | null {
  if (!credentialRef) {
    return null;
  }
  const prefix = envPrefix(credentialRef);
  const host = process.env[`${prefix}_HOST`];
  const portRaw = process.env[`${prefix}_PORT`];
  const user = process.env[`${prefix}_USER`];
  const pass = process.env[`${prefix}_PASS`];
  if (!host || !user || !pass) {
    return null;
  }
  const port = portRaw ? Number(portRaw) : 587;
  if (!Number.isFinite(port) || port <= 0) {
    return null;
  }
  const secureRaw = process.env[`${prefix}_SECURE`];
  const secure = secureRaw ? secureRaw === "true" : port === 465;
  return { host, port, secure, user, pass };
}

/**
 * Environment based mailbox credentials: the SMTP variables above,
 * extended with optional IMAP variables for reply sync.
 * <PREFIX>_IMAP_HOST defaults to the SMTP host, <PREFIX>_IMAP_PORT
 * to 993, and <PREFIX>_IMAP_SECURE to true unless set to "false".
 * A malformed IMAP port disables only the IMAP side, never SMTP.
 */
export function resolveMailboxFromEnv(
  credentialRef: string | null | undefined,
): MailboxCredentials | null {
  const smtp = resolveSmtpConfig(credentialRef);
  if (!smtp || !credentialRef) {
    return null;
  }
  const prefix = envPrefix(credentialRef);
  const imapHost = process.env[`${prefix}_IMAP_HOST`] || smtp.host;
  const imapPortRaw = process.env[`${prefix}_IMAP_PORT`];
  const imapPort = imapPortRaw ? Number(imapPortRaw) : 993;
  const imapSecureRaw = process.env[`${prefix}_IMAP_SECURE`];
  const imap: MailboxEndpoint | null =
    Number.isInteger(imapPort) && imapPort >= 1 && imapPort <= 65535
      ? {
          host: imapHost,
          port: imapPort,
          secure: imapSecureRaw ? imapSecureRaw === "true" : true,
        }
      : null;
  return {
    smtp: { host: smtp.host, port: smtp.port, secure: smtp.secure },
    imap,
    user: smtp.user,
    pass: smtp.pass,
  };
}

/**
 * Stored mailbox credentials from an encrypted blob, or null when
 * the blob is absent or is not a mailbox blob (OAuth token blobs and
 * tampered values both land here, so callers can fall back cleanly).
 */
export function resolveStoredMailboxCredentials(
  encryptedCredentials: string | null | undefined,
): MailboxCredentials | null {
  if (!encryptedCredentials) {
    return null;
  }
  try {
    return decryptMailboxCredentials(encryptedCredentials);
  } catch {
    return null;
  }
}

export interface MailboxCredentialAccount {
  credentialRef?: string | null;
  encryptedCredentials?: string | null;
}

/**
 * The one resolution order every SMTP consumer uses: credentials the
 * owner stored encrypted in the product first, the legacy server
 * environment (credentialRef) second, null when neither exists.
 */
export function resolveMailboxCredentials(
  account: MailboxCredentialAccount,
): MailboxCredentials | null {
  return (
    resolveStoredMailboxCredentials(account.encryptedCredentials) ??
    resolveMailboxFromEnv(account.credentialRef)
  );
}

function isMailboxCredentials(
  config: SmtpConfig | MailboxCredentials,
): config is MailboxCredentials {
  return "smtp" in config && typeof config.smtp === "object" && config.smtp !== null;
}

export class SmtpProvider implements MailProvider {
  readonly id = "smtp";
  readonly isSimulation = false;
  private readonly config: SmtpConfig | null;

  constructor(config: SmtpConfig | MailboxCredentials | null) {
    this.config = config
      ? isMailboxCredentials(config)
        ? mailboxSmtpConfig(config)
        : config
      : null;
  }

  async send(input: SendInput): Promise<SendResult> {
    if (!this.config) {
      throw new Error(
        "SMTP is not configured for this account. Add the mailbox password in Sending Accounts, or set the credentialRef environment variables on the server, then reconnect the account.",
      );
    }
    const transport = nodemailer.createTransport({
      host: this.config.host,
      port: this.config.port,
      secure: this.config.secure,
      auth: { user: this.config.user, pass: this.config.pass },
      ...(this.config.requireTls ? { requireTLS: true } : {}),
    });
    const info = await transport.sendMail({
      from: input.fromName ? `${input.fromName} <${input.fromEmail}>` : input.fromEmail,
      to: input.toEmail,
      subject: input.subject,
      text: input.text,
      html: input.html,
      headers: input.headers,
    });
    return { providerMessageId: info.messageId };
  }
}
