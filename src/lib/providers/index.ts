import type { SendingAccount } from "@prisma/client";
import type { MailProvider } from "./types";
import { SimulationProvider } from "./simulation";
import { SmtpProvider, resolveSmtpConfig } from "./smtp";

export type { MailProvider, SendInput, SendResult } from "./types";
export { SimulationProvider } from "./simulation";
export { SmtpProvider, resolveSmtpConfig } from "./smtp";

/**
 * Maps a sending account record to the provider that carries its mail.
 * GMAIL and MS365 accounts cannot send until their OAuth connections land
 * in Phase 3, so resolving one throws a clear, user-facing error that the
 * worker records on the enrollment instead of crashing.
 */
export function resolveProvider(account: Pick<SendingAccount, "provider" | "credentialRef">): MailProvider {
  switch (account.provider) {
    case "SIMULATION":
      return new SimulationProvider();
    case "SMTP":
      return new SmtpProvider(resolveSmtpConfig(account.credentialRef));
    default:
      throw new Error(
        `${account.provider} sending arrives with OAuth connections in Phase 3. This account cannot send yet.`,
      );
  }
}
