import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { appUrl, getOAuthConfig, isOAuthProviderId, type OAuthProviderId } from "@/lib/oauth/config";
import { verifyOAuthState } from "@/lib/oauth/state";
import { exchangeCodeForTokens, fetchProviderProfile } from "@/lib/oauth/tokens";
import { encryptOAuthTokens, hasEncryptionKey } from "@/lib/security/crypto";
import { normalizeEmail } from "@/lib/domain/dedupe";
import { writeAuditLog } from "@/lib/audit";

/**
 * OAuth callback. Exchanges the authorization code, reads the account
 * email from the provider, and creates or updates the SendingAccount
 * with the tokens stored AES-256-GCM encrypted. The state token and
 * the live session must agree on user and workspace, so a leaked state
 * cannot attach a mailbox to another tenant.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  const accountsUrl = (outcome: string, detail?: string) => {
    const url = new URL("/app/accounts", appUrl());
    url.searchParams.set("oauth", outcome);
    if (detail) {
      url.searchParams.set("detail", detail.slice(0, 200));
    }
    return NextResponse.redirect(url.toString());
  };
  if (!isOAuthProviderId(provider)) {
    return accountsUrl("error", `Unknown OAuth provider "${provider}"`);
  }
  const id: OAuthProviderId = provider;

  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const state = requestUrl.searchParams.get("state");
  const providerError = requestUrl.searchParams.get("error");
  if (providerError) {
    return accountsUrl("denied", `The provider reported: ${providerError}`);
  }
  if (!code || !state) {
    return accountsUrl("error", "The callback is missing its code or state parameter.");
  }
  const config = getOAuthConfig(id);
  if (!config) {
    return accountsUrl("error", `${id} OAuth is not configured on this server.`);
  }
  if (!hasEncryptionKey()) {
    return accountsUrl(
      "error",
      "ENCRYPTION_KEY is not set on this server, so tokens cannot be stored safely. Set it and reconnect.",
    );
  }

  const claims = await verifyOAuthState(state);
  if (!claims || claims.provider !== id) {
    return accountsUrl("error", "The OAuth state token is invalid or expired. Start the connection again.");
  }

  // The session must still belong to the user and workspace that
  // started the flow.
  const { getSessionWorkspace } = await import("@/lib/auth/session");
  const session = await getSessionWorkspace();
  if (!session || session.user.id !== claims.userId || session.workspace.id !== claims.workspaceId) {
    return accountsUrl("error", "Your session changed during the connection flow. Sign in and try again.");
  }

  try {
    const tokens = await exchangeCodeForTokens(id, code);
    const profile = await fetchProviderProfile(id, tokens.accessToken);
    const email = normalizeEmail(profile.email);

    const account = await prisma.sendingAccount.upsert({
      where: { workspaceId_email: { workspaceId: claims.workspaceId, email } },
      update: {
        provider: config.accountProvider,
        status: "CONNECTED",
        encryptedCredentials: encryptOAuthTokens(tokens),
        tokenExpiresAt: new Date(tokens.expiresAt),
        providerAccountId: profile.providerAccountId,
        credentialRef: null,
        lastError: null,
      },
      create: {
        workspaceId: claims.workspaceId,
        email,
        provider: config.accountProvider,
        status: "CONNECTED",
        dailyLimit: 50,
        encryptedCredentials: encryptOAuthTokens(tokens),
        tokenExpiresAt: new Date(tokens.expiresAt),
        providerAccountId: profile.providerAccountId,
      },
    });
    await writeAuditLog({
      action: "account.connect",
      userId: session.user.id,
      workspaceId: claims.workspaceId,
      metadata: { accountId: account.id, provider: account.provider, email: account.email },
    });
    return accountsUrl("connected", account.email);
  } catch (error) {
    const message = error instanceof Error ? error.message : "OAuth exchange failed";
    return accountsUrl("error", message);
  }
}
