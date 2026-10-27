import { NextResponse } from "next/server";
import { apiError, requireSession } from "@/lib/api";
import { buildHubSpotAuthorizeUrl, getHubSpotConfig, hubspotMissingEnv } from "@/lib/crm/hubspot";
import { createCrmState } from "@/lib/crm/state";
import { hasEncryptionKey } from "@/lib/security/crypto";

/**
 * Starts the HubSpot connection for the active workspace.
 *
 * Mirrors the mailbox OAuth start route: when the app credentials
 * are not configured the route answers 501 naming the missing
 * variables instead of redirecting to a consent screen that cannot
 * work, and the Settings HubSpot card shows the same state.
 */
export async function GET() {
  const session = await requireSession("ADMIN");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const config = getHubSpotConfig();
  if (!config) {
    return NextResponse.json(
      {
        error: `HubSpot is not configured on this server. Set ${hubspotMissingEnv().join(" and ")} in the environment, then try again. See ACTIVATION.md section 8.`,
        missingEnv: hubspotMissingEnv(),
      },
      { status: 501 },
    );
  }
  if (!hasEncryptionKey()) {
    return NextResponse.json(
      {
        error: "ENCRYPTION_KEY is not set on this server, so HubSpot tokens cannot be stored safely. Set it and try again.",
        missingEnv: ["ENCRYPTION_KEY"],
      },
      { status: 501 },
    );
  }
  try {
    const state = await createCrmState({
      workspaceId: ctx.workspace.id,
      userId: ctx.user.id,
      provider: "hubspot",
    });
    return NextResponse.redirect(buildHubSpotAuthorizeUrl(config, state));
  } catch (error) {
    return apiError(error);
  }
}
