/**
 * Bundled disposable (throwaway) email domain list.
 *
 * This is a PARTIAL list: a few dozen of the best known disposable
 * mailbox services, bundled so the built-in verifier works with no
 * external dependency. Disposable domains are created faster than
 * any bundled list can track, so a miss here means "not recognised
 * as disposable", never "proven real". The optional verification
 * provider (src/lib/verify/provider.ts) maintains a far larger list
 * server side; this one is the offline floor.
 */

const DISPOSABLE_DOMAINS: ReadonlySet<string> = new Set([
  "10minutemail.com",
  "10minutemail.net",
  "20minutemail.com",
  "33mail.com",
  "anonbox.net",
  "bccto.me",
  "burnermail.io",
  "crazymailing.com",
  "deadaddress.com",
  "dispostable.com",
  "dropmail.me",
  "emailondeck.com",
  "fakeinbox.com",
  "fakemail.net",
  "getairmail.com",
  "getnada.com",
  "grr.la",
  "guerrillamail.biz",
  "guerrillamail.com",
  "guerrillamail.net",
  "guerrillamail.org",
  "guerrillamailblock.com",
  "harakirimail.com",
  "incognitomail.org",
  "jetable.org",
  "mailcatch.com",
  "maildrop.cc",
  "mailexpire.com",
  "mailinator.com",
  "mailinator.net",
  "mailnesia.com",
  "mailsac.com",
  "mintemail.com",
  "mohmal.com",
  "mytemp.email",
  "mytrashmail.com",
  "oneoffemail.com",
  "owlymail.com",
  "pokemail.net",
  "safetymail.info",
  "sharklasers.com",
  "spam4.me",
  "spambox.us",
  "spamfree24.org",
  "spammotel.com",
  "temp-mail.org",
  "tempail.com",
  "tempinbox.com",
  "tempmail.com",
  "tempmail.net",
  "tempmailo.com",
  "tempr.email",
  "throwawaymail.com",
  "trash-mail.com",
  "trashmail.at",
  "trashmail.com",
  "trashmail.io",
  "trashmail.me",
  "trashmail.net",
  "wegwerfmail.de",
  "yopmail.com",
  "yopmail.fr",
  "yopmail.net",
]);

export function isDisposableDomain(domain: string): boolean {
  const cleaned = domain.trim().toLowerCase().replace(/\.$/, "");
  if (DISPOSABLE_DOMAINS.has(cleaned)) {
    return true;
  }
  // Subdomains of a listed service are disposable too.
  for (const listed of DISPOSABLE_DOMAINS) {
    if (cleaned.endsWith(`.${listed}`)) {
      return true;
    }
  }
  return false;
}
