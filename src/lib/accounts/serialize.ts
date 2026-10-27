import type { SendingAccount } from "@prisma/client";

/**
 * The API shape for a sending account. encryptedCredentials is a
 * server only secret blob (OAuth tokens or an encrypted mailbox
 * password) and is stripped from every accounts endpoint response;
 * clients learn only whether stored credentials exist.
 */
export type PublicSendingAccount = Omit<SendingAccount, "encryptedCredentials"> & {
  hasStoredCredentials: boolean;
};

export function toPublicSendingAccount(account: SendingAccount): PublicSendingAccount {
  const { encryptedCredentials, ...rest } = account;
  return { ...rest, hasStoredCredentials: encryptedCredentials !== null };
}
