import type { PrismaClient, SendingAccount } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { MailProvider } from "./types";
import { SimulationProvider } from "./simulation";
import { SmtpProvider, resolveSmtpConfig } from "./smtp";
import { GmailProvider } from "./gmail";
import { GraphProvider } from "./graph";

export type { MailProvider, SendInput, SendResult } from "./types";
export { SimulationProvider } from "./simulation";
export { SmtpProvider, resolveSmtpConfig } from "./smtp";
export { GmailProvider } from "./gmail";
export { GraphProvider } from "./graph";

/**
 * Maps a sending account record to the provider that carries its mail.
 *
 * GMAIL and MS365 accounts send through their stored OAuth tokens
 * (AES-256-GCM encrypted at rest) once connected; the token layer
 * refreshes them transparently. An OAuth account with no stored tokens
 * is not connected, and resolving it throws a clear error the worker
 * records on the enrollment instead of failing silently. Resolution is
 * async because a refresh may need a network round trip.
 */
export async function resolveProvider(
  account: SendingAccount,
  db: PrismaClient = prisma,
): Promise<MailProvider> {
  switch (account.provider) {
    case "SIMULATION":
      return new SimulationProvider();
    case "SMTP":
      return new SmtpProvider(resolveSmtpConfig(account.credentialRef));
    case "GMAIL":
      if (!account.encryptedCredentials) {
        throw new Error(
          "This Gmail account is not connected. Connect it from Sending Accounts before it can send.",
        );
      }
      return new GmailProvider(db, account);
    case "MS365":
      if (!account.encryptedCredentials) {
        throw new Error(
          "This Microsoft 365 account is not connected. Connect it from Sending Accounts before it can send.",
        );
      }
      return new GraphProvider(db, account);
    default:
      throw new Error(`Unknown provider "${account.provider}".`);
  }
}
