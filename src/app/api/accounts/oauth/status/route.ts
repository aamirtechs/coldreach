import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api";
import { oauthProviderStatuses } from "@/lib/oauth/config";
import { hasEncryptionKey } from "@/lib/security/crypto";

/**
 * Reports which OAuth providers this server can actually connect:
 * configured only when the client id and secret are present AND the
 * encryption key exists to store the tokens. The Accounts UI renders
 * "Not configured" with the missing variable names from this payload
 * instead of offering a connect button that could not work.
 */
export async function GET() {
  const session = await requireSession("VIEWER");
  if ("error" in session) return session.error;
  const encryptionReady = hasEncryptionKey();
  const providers = oauthProviderStatuses().map((status) => ({
    ...status,
    configured: status.configured && encryptionReady,
    missingEnv: encryptionReady ? status.missingEnv : [...status.missingEnv, "ENCRYPTION_KEY"],
  }));
  return NextResponse.json({ providers, encryptionReady });
}
