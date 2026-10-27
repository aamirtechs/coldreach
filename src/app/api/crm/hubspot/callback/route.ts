import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { appUrl } from "@/lib/oauth/config";
import { exchangeHubSpotCode, getHubSpotConfig, HUBSPOT_PROVIDER } from "@/lib/crm/hubspot";
import { verifyCrmState } from "@/lib/crm/state";
import { encryptOAuthTokens, hasEncryptionKey } from "@/lib/security/crypto";
import { writeAuditLog } from "@/lib/audit";

/**
 * HubSpot OAuth callback. Exchanges the authorization code and
 * stores the tokens AES-256-GCM encrypted on the workspace's
 * CrmConnection row. The signed state and the live session must
 * agree on user and workspace, mirroring the mailbox callback, so a
 * leaked state cannot attach a CRM to another tenant. The browser
 * lands back on Settings, where the HubSpot card shows the result.
 */
export async function GET(request: Request) {
  const settingsUrl = (outcome: string, detail?: string) => {
    const url = new URL("/app/settings", appUrl());
    url.searchParams.set("crm", outcome);
    if (detail) {
      url.searchParams.set("detail", detail.slice(0, 200));
    }
    return NextResponse.redirect(url.toString());
  };

  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const state = requestUrl.searchParams.get("state");
  const providerError = requestUrl.searchParams.get("error");
  if (providerError) {
    return settingsUrl("error", `HubSpot reported: ${providerError}`);
  }
  if (!code || !state) {
    return settingsUrl("error", "The callback is missing its code or state parameter.");
  }
  const config = getHubSpotConfig();
  if (!config) {
    return settingsUrl("error", "HubSpot is not configured on this server.");
  }
  if (!hasEncryptionKey()) {
    return settingsUrl("error", "ENCRYPTION_KEY is not set on this server, so tokens cannot be stored safely.");
  }

  const claims = await verifyCrmState(state);
  if (!claims || claims.provider !== "hubspot") {
    return settingsUrl("error", "The connection state token is invalid or expired. Start the connection again.");
  }

  const { getSessionWorkspace } = await import("@/lib/auth/session");
  const session = await getSessionWorkspace();
  if (!session || session.user.id !== claims.userId || session.workspace.id !== claims.workspaceId) {
    return settingsUrl("error", "Your session changed during the connection flow. Sign in and try again.");
  }

  try {
    const { tokens, portalId } = await exchangeHubSpotCode(config, code);
    await prisma.crmConnection.upsert({
      where: { workspaceId_provider: { workspaceId: claims.workspaceId, provider: HUBSPOT_PROVIDER } },
      update: {
        status: "CONNECTED",
        encryptedCredentials: encryptOAuthTokens(tokens),
        externalAccountId: portalId,
      },
      create: {
        workspaceId: claims.workspaceId,
        provider: HUBSPOT_PROVIDER,
        status: "CONNECTED",
        encryptedCredentials: encryptOAuthTokens(tokens),
        externalAccountId: portalId,
      },
    });
    await writeAuditLog({
      action: "crm.hubspot_connect",
      userId: session.user.id,
      workspaceId: claims.workspaceId,
      metadata: { provider: HUBSPOT_PROVIDER, portalId },
    });
    return settingsUrl("connected", portalId ? `portal ${portalId}` : undefined);
  } catch (error) {
    const message = error instanceof Error ? error.message : "HubSpot exchange failed";
    return settingsUrl("error", message);
  }
}
