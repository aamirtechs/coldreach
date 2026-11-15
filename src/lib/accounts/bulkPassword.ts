import type { PrismaClient } from "@prisma/client";
import {
  decryptMailboxCredentials,
  encryptMailboxCredentials,
  type MailboxCredentials,
} from "@/lib/providers/smtp";
import { parseMailboxInput } from "@/lib/accounts/mailboxInput";
import {
  testMailboxConnection,
  type MailboxConnectionVerifier,
} from "@/lib/accounts/testConnection";

/**
 * One password for many mailboxes (v1.28.0).
 *
 * Many mailbox owners use the same password on every account (one
 * cPanel password across all addresses is the common case). This
 * module applies a single typed password to a set of SMTP accounts:
 * for each account it builds candidate credentials, proves them with
 * the live connection test, and only then stores them encrypted and
 * marks the account CONNECTED. An account whose test fails is left
 * completely untouched and reported with the friendly failure reason.
 * The password itself is never stored anywhere except inside each
 * account's encrypted credentials blob, and never logged or returned.
 *
 * Candidate settings come from the account's stored blob when it can
 * still be decrypted (the normal password rotation case: hosts and
 * username are reused, only the password changes). When the blob
 * cannot be read, for example after a server move rotated the
 * encryption key, the standard cPanel layout is derived from the
 * account's own domain: mail.<domain> on 465 for SMTP and 993 for
 * IMAP, username equal to the email address. The live test is the
 * safety net either way: derived settings that do not authenticate
 * are never saved.
 */

export interface BulkPasswordAccount {
  id: string;
  email: string;
  encryptedCredentials: string | null;
}

export interface BulkPasswordResult {
  accountId: string;
  email: string;
  ok: boolean;
  error?: string;
}

/** Builds the credentials to try for one account with the new password. */
export function candidateCredentials(
  account: BulkPasswordAccount,
  password: string,
): MailboxCredentials | null {
  if (account.encryptedCredentials) {
    try {
      const stored = decryptMailboxCredentials(account.encryptedCredentials);
      return { ...stored, pass: password };
    } catch {
      // Unreadable blob (rotated key or legacy data): fall through to
      // the derived defaults below.
    }
  }
  const domain = account.email.split("@")[1]?.trim() ?? "";
  if (!domain) {
    return null;
  }
  const parsed = parseMailboxInput(
    { smtpHost: `mail.${domain}`, password },
    account.email,
  );
  return parsed.ok ? parsed.credentials : null;
}

/**
 * Applies the password to the given accounts one at a time (serial on
 * purpose: a burst of simultaneous logins can trip mail server rate
 * limits). Returns one result per account, in input order.
 */
export async function applyPasswordToAccounts(
  prisma: PrismaClient,
  accounts: BulkPasswordAccount[],
  password: string,
  verifier?: MailboxConnectionVerifier,
): Promise<BulkPasswordResult[]> {
  const results: BulkPasswordResult[] = [];
  for (const account of accounts) {
    const candidate = candidateCredentials(account, password);
    if (!candidate) {
      results.push({
        accountId: account.id,
        email: account.email,
        ok: false,
        error:
          "Could not work out this mailbox's server settings. Reconnect it individually from the account form.",
      });
      continue;
    }
    const check = await testMailboxConnection(candidate, verifier);
    const imapOk = candidate.imap === null || check.imap.ok;
    if (check.smtp.ok && imapOk) {
      await prisma.sendingAccount.update({
        where: { id: account.id },
        data: {
          encryptedCredentials: encryptMailboxCredentials(candidate),
          // The stored blob replaces any legacy environment reference,
          // the same either-or rule the account create route enforces.
          credentialRef: null,
          status: "CONNECTED",
          lastError: null,
        },
      });
      results.push({ accountId: account.id, email: account.email, ok: true });
    } else {
      results.push({
        accountId: account.id,
        email: account.email,
        ok: false,
        error: !check.smtp.ok ? check.smtp.error : check.imap.error,
      });
    }
  }
  return results;
}
