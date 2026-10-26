import type { PrismaClient, SendingAccount } from "@prisma/client";
import {
  decryptOAuthTokens,
  encryptOAuthTokens,
  type OAuthTokens,
} from "@/lib/security/crypto";
import { getOAuthConfig, specForAccountProvider, type OAuthProviderId } from "./config";

/**
 * OAuth token storage and refresh.
 *
 * Tokens live only inside SendingAccount.encryptedCredentials
 * (AES-256-GCM). Providers call getValidAccessToken, which returns the
 * stored access token while it is comfortably valid and refreshes it
 * through the provider's token endpoint when it is not, persisting the
 * rotated tokens encrypted again. A failed refresh marks the account
 * ERROR with the provider's message, so the operator sees exactly why
 * sending stopped instead of a silent failure.
 */

interface TokenEndpointResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
  id?: string;
  email?: string;
  mail?: string;
  userPrincipalName?: string;
}

async function postTokenForm(
  config: NonNullable<ReturnType<typeof getOAuthConfig>>,
  params: Record<string, string>,
): Promise<TokenEndpointResponse> {
  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  const data = (await response.json().catch(() => ({}))) as TokenEndpointResponse;
  if (!response.ok || !data.access_token) {
    const detail = data.error_description || data.error || `HTTP ${response.status}`;
    throw new Error(`Token request failed: ${detail}`);
  }
  return data;
}

function tokensFromResponse(data: TokenEndpointResponse, previous?: OAuthTokens): OAuthTokens {
  return {
    accessToken: data.access_token as string,
    // Providers may omit the refresh token on refresh responses;
    // the previously stored one stays valid in that case.
    refreshToken: data.refresh_token ?? previous?.refreshToken ?? null,
    expiresAt: new Date(Date.now() + (data.expires_in ?? 3600) * 1000).toISOString(),
    scope: data.scope ?? previous?.scope,
    tokenType: data.token_type ?? previous?.tokenType,
  };
}

export async function exchangeCodeForTokens(
  provider: OAuthProviderId,
  code: string,
): Promise<OAuthTokens> {
  const config = getOAuthConfig(provider);
  if (!config) {
    throw new Error(`${provider} OAuth is not configured on this server.`);
  }
  const data = await postTokenForm(config, {
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    grant_type: "authorization_code",
  });
  return tokensFromResponse(data);
}

export async function fetchProviderProfile(
  provider: OAuthProviderId,
  accessToken: string,
): Promise<{ email: string; providerAccountId: string | null }> {
  if (provider === "google") {
    const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      throw new Error(`Could not read the Google account profile (HTTP ${response.status}).`);
    }
    const data = (await response.json()) as TokenEndpointResponse;
    if (!data.email) {
      throw new Error("Google did not return an email address for this account.");
    }
    return { email: data.email.toLowerCase(), providerAccountId: data.id ?? null };
  }
  const response = await fetch("https://graph.microsoft.com/v1.0/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error(`Could not read the Microsoft account profile (HTTP ${response.status}).`);
  }
  const data = (await response.json()) as TokenEndpointResponse;
  const email = (data.mail || data.userPrincipalName || "").toLowerCase();
  if (!email) {
    throw new Error("Microsoft did not return an email address for this account.");
  }
  return { email, providerAccountId: data.id ?? null };
}

export function readStoredTokens(account: Pick<SendingAccount, "encryptedCredentials">): OAuthTokens {
  if (!account.encryptedCredentials) {
    throw new Error("This account has no stored OAuth credentials. Reconnect it from Sending Accounts.");
  }
  return decryptOAuthTokens(account.encryptedCredentials);
}

const REFRESH_SKEW_MS = 60_000;

export async function refreshAccessToken(
  db: PrismaClient,
  account: SendingAccount,
  tokens: OAuthTokens,
): Promise<OAuthTokens> {
  const spec = specForAccountProvider(account.provider);
  if (!spec) {
    throw new Error(`Provider ${account.provider} does not use OAuth tokens.`);
  }
  if (!tokens.refreshToken) {
    throw new Error("The stored credentials have no refresh token. Reconnect the account.");
  }
  const config = getOAuthConfig(spec.id);
  if (!config) {
    throw new Error(
      `${spec.label} OAuth is not configured on this server (missing ${spec.idEnv} or ${spec.secretEnv}).`,
    );
  }
  try {
    const params: Record<string, string> = {
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: tokens.refreshToken,
      grant_type: "refresh_token",
    };
    if (spec.id === "microsoft") {
      params.scope = config.scopes.join(" ");
    }
    const data = await postTokenForm(config, params);
    const fresh = tokensFromResponse(data, tokens);
    await db.sendingAccount.update({
      where: { id: account.id },
      data: {
        encryptedCredentials: encryptOAuthTokens(fresh),
        tokenExpiresAt: new Date(fresh.expiresAt),
        status: "CONNECTED",
        lastError: null,
      },
    });
    return fresh;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Token refresh failed";
    await db.sendingAccount.update({
      where: { id: account.id },
      data: { status: "ERROR", lastError: `OAuth token refresh failed: ${message}` },
    });
    throw new Error(`OAuth token refresh failed for ${account.email}: ${message}`);
  }
}

/**
 * Returns an access token for the account, refreshing first when the
 * stored one is expired or inside the refresh skew window.
 */
export async function getValidAccessToken(
  db: PrismaClient,
  account: SendingAccount,
): Promise<string> {
  const tokens = readStoredTokens(account);
  const expiresAt = new Date(tokens.expiresAt).getTime();
  if (Number.isFinite(expiresAt) && expiresAt - Date.now() > REFRESH_SKEW_MS) {
    return tokens.accessToken;
  }
  const fresh = await refreshAccessToken(db, account, tokens);
  return fresh.accessToken;
}
