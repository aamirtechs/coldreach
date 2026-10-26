import { randomUUID } from "node:crypto";
import type { PrismaClient, SendingAccount } from "@prisma/client";
import { getValidAccessToken } from "@/lib/oauth/tokens";
import type { MailProvider, SendInput, SendResult } from "./types";

/**
 * Gmail transport. Sends through the Gmail API with the account's
 * stored OAuth tokens (refreshed transparently when expired).
 *
 * The MIME message carries a Message-ID generated here, and that id is
 * what the send records as providerMessageId: replies reference the
 * Message-ID in their In-Reply-To header, which is exactly what reply
 * sync matches on. The Gmail API's own internal id is not what other
 * mail clients quote back.
 */

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function buildMime(input: SendInput, messageId: string): string {
  const boundary = `coldreach-${randomUUID()}`;
  const from = input.fromName ? `${input.fromName} <${input.fromEmail}>` : input.fromEmail;
  const headers = [
    `From: ${from}`,
    `To: ${input.toEmail}`,
    `Subject: ${input.subject}`,
    `Message-ID: <${messageId}>`,
    "MIME-Version: 1.0",
    ...(input.headers
      ? Object.entries(input.headers).map(([key, value]) => `${key}: ${value}`)
      : []),
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  const parts = [
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "",
    input.text,
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "",
    input.html,
    `--${boundary}--`,
    "",
  ];
  return [...headers, "", ...parts].join("\r\n");
}

export class GmailProvider implements MailProvider {
  readonly id = "gmail";
  readonly isSimulation = false;

  constructor(
    private readonly db: PrismaClient,
    private readonly account: SendingAccount,
  ) {}

  async send(input: SendInput): Promise<SendResult> {
    const accessToken = await getValidAccessToken(this.db, this.account);
    const messageId = `cr-${randomUUID()}@coldreach`;
    const raw = base64UrlEncode(buildMime(input, messageId));
    const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Gmail send failed (HTTP ${response.status}): ${detail.slice(0, 300)}`);
    }
    return { providerMessageId: messageId };
  }
}
