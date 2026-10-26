/**
 * OAuth provider configuration for Gmail and Microsoft 365.
 *
 * Configuration comes entirely from environment variables. When a
 * provider's variables are absent the provider is "not configured":
 * the connect routes return a plain error naming the missing variables
 * and the UI shows the same, instead of a connect button that would
 * fail silently or pretend to work. See INTEGRATIONS.md for the owner
 * steps that create these credentials.
 */

export type OAuthProviderId = "google" | "microsoft";

export interface OAuthProviderConfig {
  id: OAuthProviderId;
  /** SendingAccount provider value accounts of this type carry. */
  accountProvider: "GMAIL" | "MS365";
  label: string;
  clientId: string;
  clientSecret: string;
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  redirectUri: string;
}

interface ProviderSpec {
  id: OAuthProviderId;
  accountProvider: "GMAIL" | "MS365";
  label: string;
  idEnv: string;
  secretEnv: string;
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
}

const SPECS: ProviderSpec[] = [
  {
    id: "google",
    accountProvider: "GMAIL",
    label: "Gmail",
    idEnv: "GOOGLE_CLIENT_ID",
    secretEnv: "GOOGLE_CLIENT_SECRET",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: [
      "openid",
      "email",
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/gmail.readonly",
    ],
  },
  {
    id: "microsoft",
    accountProvider: "MS365",
    label: "Microsoft 365",
    idEnv: "MS_CLIENT_ID",
    secretEnv: "MS_CLIENT_SECRET",
    authorizeUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scopes: [
      "openid",
      "profile",
      "email",
      "offline_access",
      "https://graph.microsoft.com/Mail.Send",
      "https://graph.microsoft.com/Mail.Read",
    ],
  },
];

export function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export function isOAuthProviderId(value: string): value is OAuthProviderId {
  return value === "google" || value === "microsoft";
}

export function missingEnvFor(spec: ProviderSpec): string[] {
  const missing: string[] = [];
  if (!process.env[spec.idEnv]) missing.push(spec.idEnv);
  if (!process.env[spec.secretEnv]) missing.push(spec.secretEnv);
  return missing;
}

/** Names of the environment variables a provider still needs, or []. */
export function missingProviderEnv(id: OAuthProviderId): string[] {
  const spec = SPECS.find((entry) => entry.id === id);
  return spec ? missingEnvFor(spec) : [];
}

export function getOAuthConfig(id: OAuthProviderId): OAuthProviderConfig | null {
  const spec = SPECS.find((entry) => entry.id === id);
  if (!spec || missingEnvFor(spec).length > 0) {
    return null;
  }
  return {
    id: spec.id,
    accountProvider: spec.accountProvider,
    label: spec.label,
    clientId: process.env[spec.idEnv] as string,
    clientSecret: process.env[spec.secretEnv] as string,
    authorizeUrl: spec.authorizeUrl,
    tokenUrl: spec.tokenUrl,
    scopes: spec.scopes,
    redirectUri: `${appUrl()}/api/accounts/oauth/${spec.id}/callback`,
  };
}

export interface OAuthProviderStatus {
  id: OAuthProviderId;
  accountProvider: "GMAIL" | "MS365";
  label: string;
  configured: boolean;
  missingEnv: string[];
}

export function oauthProviderStatuses(): OAuthProviderStatus[] {
  return SPECS.map((spec) => {
    const missingEnv = missingEnvFor(spec);
    return {
      id: spec.id,
      accountProvider: spec.accountProvider,
      label: spec.label,
      configured: missingEnv.length === 0,
      missingEnv,
    };
  });
}

export function specForAccountProvider(provider: string): ProviderSpec | null {
  return SPECS.find((entry) => entry.accountProvider === provider) ?? null;
}
