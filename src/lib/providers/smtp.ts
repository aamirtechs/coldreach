import nodemailer from "nodemailer";
import type { MailProvider, SendInput, SendResult } from "./types";

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
}

/**
 * Resolves SMTP settings from the environment using the account's
 * credentialRef as a prefix. For a credentialRef of "ACME_SMTP" the
 * variables are ACME_SMTP_HOST, ACME_SMTP_PORT, ACME_SMTP_USER,
 * ACME_SMTP_PASS, and optional ACME_SMTP_SECURE ("true" or "false").
 *
 * Passwords live in the deployment environment (and later a credential
 * vault), never in the database. The database holds only the ref.
 * Returns null when any required variable is missing.
 */
export function resolveSmtpConfig(credentialRef: string | null | undefined): SmtpConfig | null {
  if (!credentialRef) {
    return null;
  }
  const prefix = credentialRef.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");
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

export class SmtpProvider implements MailProvider {
  readonly id = "smtp";
  readonly isSimulation = false;

  constructor(private readonly config: SmtpConfig | null) {}

  async send(input: SendInput): Promise<SendResult> {
    if (!this.config) {
      throw new Error(
        "SMTP is not configured for this account. Set the credentialRef environment variables on the server, then reconnect the account.",
      );
    }
    const transport = nodemailer.createTransport({
      host: this.config.host,
      port: this.config.port,
      secure: this.config.secure,
      auth: { user: this.config.user, pass: this.config.pass },
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
