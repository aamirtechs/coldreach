import type { MailboxCredentials, MailboxEndpoint } from "@/lib/providers/smtp";

/**
 * Parsing and validation for user entered mailbox settings, shared
 * by the account create route and the connection test route so both
 * accept exactly the same shape. The password is read verbatim (it
 * is never trimmed, logged, or echoed back); every other field is a
 * trimmed string, a number, or a boolean from the JSON body.
 */

export interface MailboxInputBody {
  smtpHost?: unknown;
  smtpPort?: unknown;
  smtpSecure?: unknown;
  imapHost?: unknown;
  imapPort?: unknown;
  imapSecure?: unknown;
  username?: unknown;
  password?: unknown;
}

const MAILBOX_FIELDS: Array<keyof MailboxInputBody> = [
  "smtpHost",
  "smtpPort",
  "smtpSecure",
  "imapHost",
  "imapPort",
  "imapSecure",
  "username",
  "password",
];

/** True when the body carries any mailbox field with a real value. */
export function hasMailboxInput(body: MailboxInputBody): boolean {
  return MAILBOX_FIELDS.some((field) => {
    const value = body[field];
    return value !== undefined && value !== null && value !== "";
  });
}

function isValidHost(host: string): boolean {
  if (host.length === 0 || host.length > 253 || /\s/.test(host) || host.includes("/")) {
    return false;
  }
  if (host === "localhost") {
    return true;
  }
  // IPv4 literal.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return host.split(".").every((part) => Number(part) <= 255);
  }
  // Hostname: dot separated labels of letters, digits, and hyphens.
  if (!host.includes(".")) {
    return false;
  }
  return host
    .split(".")
    .every(
      (label) =>
        label.length >= 1 &&
        label.length <= 63 &&
        /^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(label),
    );
}

function parsePort(value: unknown, fallback: number, label: string): number | string {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const port = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return `${label} must be a whole number between 1 and 65535.`;
  }
  return port;
}

function parseSecure(value: unknown, fallback: boolean, label: string): boolean | string {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (value === "true" || value === 1) {
    return true;
  }
  if (value === "false" || value === 0) {
    return false;
  }
  return `${label} must be true or false.`;
}

function parseEndpoint(
  hostValue: unknown,
  portValue: unknown,
  secureValue: unknown,
  defaults: MailboxEndpoint,
  labels: { host: string; port: string; secure: string },
): MailboxEndpoint | string {
  const host =
    typeof hostValue === "string" && hostValue.trim().length > 0
      ? hostValue.trim()
      : defaults.host;
  if (!isValidHost(host)) {
    return `${labels.host} "${host}" does not look like a mail server hostname.`;
  }
  const port = parsePort(portValue, defaults.port, labels.port);
  if (typeof port === "string") {
    return port;
  }
  const secure = parseSecure(secureValue, port === defaults.port ? defaults.secure : port === 465 || port === 993, labels.secure);
  if (typeof secure === "string") {
    return secure;
  }
  return { host, port, secure };
}

export type MailboxInputResult =
  | { ok: true; credentials: MailboxCredentials }
  | { ok: false; error: string };

/**
 * Validates raw mailbox fields into MailboxCredentials.
 * fallbackEmail supplies the account email: the username defaults
 * to it (cPanel usernames are full addresses) and the IMAP host
 * defaults to the SMTP host when not given.
 */
export function parseMailboxInput(
  body: MailboxInputBody,
  fallbackEmail: string,
): MailboxInputResult {
  const smtpHostRaw = typeof body.smtpHost === "string" ? body.smtpHost.trim() : "";
  if (!smtpHostRaw) {
    return { ok: false, error: "An SMTP host is required for mailbox accounts." };
  }
  if (typeof body.password !== "string" || body.password.length === 0) {
    return { ok: false, error: "The mailbox password is required." };
  }
  const username =
    typeof body.username === "string" && body.username.trim().length > 0
      ? body.username.trim()
      : fallbackEmail.trim();
  if (!username) {
    return {
      ok: false,
      error: "A mailbox username is required. For cPanel it is the full email address.",
    };
  }
  const smtp = parseEndpoint(
    body.smtpHost,
    body.smtpPort,
    body.smtpSecure,
    { host: smtpHostRaw, port: 465, secure: true },
    { host: "SMTP host", port: "SMTP port", secure: "SMTP secure" },
  );
  if (typeof smtp === "string") {
    return { ok: false, error: smtp };
  }

  // IMAP can be explicitly disabled with imapHost: null; otherwise it
  // defaults to the SMTP host on port 993 with implicit TLS, which is
  // the standard cPanel layout.
  let imap: MailboxEndpoint | null = null;
  if (body.imapHost !== null) {
    const parsedImap = parseEndpoint(
      body.imapHost,
      body.imapPort,
      body.imapSecure,
      { host: smtp.host, port: 993, secure: true },
      { host: "IMAP host", port: "IMAP port", secure: "IMAP secure" },
    );
    if (typeof parsedImap === "string") {
      return { ok: false, error: parsedImap };
    }
    imap = parsedImap;
  }

  return {
    ok: true,
    credentials: { smtp, imap, user: username, pass: body.password },
  };
}
