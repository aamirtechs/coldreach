import type { PrismaClient } from "@prisma/client";
import { isPlatformOwner } from "./platform";

/**
 * Platform feature access (v1.36.0).
 *
 * Email verification runs on the platform's own Reacher sidecar,
 * so it is owner-only until the platform admin opens it to every
 * user from the admin panel's Feature access switch. The switch
 * is a PlatformSetting row; no row means closed. The platform
 * owner always has access, switch or no switch, so the panel can
 * never lock him out of the feature he is gating.
 */

export const VERIFICATION_PUBLIC_SETTING_KEY = "verification_public_enabled";

/** True when the admin switch opens verification to all users. */
export async function isVerificationPublicEnabled(db: PrismaClient): Promise<boolean> {
  const row = await db.platformSetting.findUnique({
    where: { key: VERIFICATION_PUBLIC_SETTING_KEY },
  });
  return row?.value === "true";
}

/** Writes the admin switch. */
export async function setVerificationPublicEnabled(
  db: PrismaClient,
  enabled: boolean,
): Promise<void> {
  await db.platformSetting.upsert({
    where: { key: VERIFICATION_PUBLIC_SETTING_KEY },
    create: { key: VERIFICATION_PUBLIC_SETTING_KEY, value: enabled ? "true" : "false" },
    update: { value: enabled ? "true" : "false" },
  });
}

/**
 * Whether this signed-in user may use the probing verification
 * features (the Verify Emails tool, list verification, and the
 * import wizard's verify step). The platform owner always may;
 * everyone else needs the admin switch on.
 */
export async function canUseVerification(
  db: PrismaClient,
  email: string | null | undefined,
): Promise<boolean> {
  if (isPlatformOwner(email)) {
    return true;
  }
  return isVerificationPublicEnabled(db);
}
