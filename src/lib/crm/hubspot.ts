import type { PrismaClient } from "@prisma/client";
import { decryptOAuthTokens, encryptOAuthTokens, type OAuthTokens } from "@/lib/security/crypto";
import { appUrl } from "@/lib/oauth/config";
import { logger } from "@/lib/log";

/**
 * HubSpot CRM sync (Phase 6), credential gated exactly like the
 * mailbox providers.
 *
 * The owner creates a HubSpot public app and sets HUBSPOT_CLIENT_ID
 * and HUBSPOT_CLIENT_SECRET (steps in INTEGRATIONS.md). Until then
 * every entry point reports "not configured" naming the variables,
 * and no connect button pretends to work.
 *
 * Scope of the sync, stated plainly: it PUSHES the workspace's leads
 * to HubSpot as contacts, creating or updating by email. It does NOT
 * pull HubSpot unsubscribes or deletions back into suppressions:
 * the contacts scopes granted here do not expose subscription or
 * deletion state (that lives behind HubSpot's email and settings
 * APIs with separate scopes), so the sync records the limitation in
 * every run summary instead of inventing a pull. Do-not-contact in
 * the other direction stays available through outbound webhooks and
 * the public API (INTEGRATIONS.md section 7).
 *
 * Tokens live only in CrmConnection.encryptedCredentials
 * (AES-256-GCM), the same discipline as mailbox OAuth.
 */

export const HUBSPOT_PROVIDER = "HUBSPOT";
export const HUBSPOT_SCOPES = ["crm.objects.contacts.read", "crm.objects.contacts.write"];

const AUTHORIZE_URL = "https://app.hubspot.com/oauth/authorize";
const TOKEN_URL = "https://api.hubapi.com/oauth/v1/token";
const API_BASE = "https://api.hubapi.com";

export function hubspotMissingEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const missing: string[] = [];
  if (!env.HUBSPOT_CLIENT_ID) missing.push("HUBSPOT_CLIENT_ID");
  if (!env.HUBSPOT_CLIENT_SECRET) missing.push("HUBSPOT_CLIENT_SECRET");
  return missing;
}

export function hubspotConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return hubspotMissingEnv(env).length === 0;
}

export interface HubSpotConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
}

export function getHubSpotConfig(env: NodeJS.ProcessEnv = process.env): HubSpotConfig | null {
  if (!hubspotConfigured(env)) {
    return null;
  }
  return {
    clientId: env.HUBSPOT_CLIENT_ID as string,
    clientSecret: env.HUBSPOT_CLIENT_SECRET as string,
    redirectUri: `${appUrl()}/api/crm/hubspot/callback`,
    scopes: HUBSPOT_SCOPES,
  };
}

export function buildHubSpotAuthorizeUrl(config: HubSpotConfig, state: string): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("scope", config.scopes.join(" "));
  url.searchParams.set("state", state);
  return url.toString();
}

// ---------------------------------------------------------------------
// Token exchange and refresh
// ---------------------------------------------------------------------

interface HubSpotTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  hub_id?: number;
  error?: string;
  message?: string;
}

type FetchImpl = typeof fetch;

async function postTokenForm(
  config: HubSpotConfig,
  params: Record<string, string>,
  fetchImpl: FetchImpl,
): Promise<HubSpotTokenResponse> {
  const response = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  const data = (await response.json().catch(() => ({}))) as HubSpotTokenResponse;
  if (!response.ok || !data.access_token) {
    const detail = data.message || data.error || `HTTP ${response.status}`;
    throw new Error(`HubSpot token request failed: ${detail}`);
  }
  return data;
}

function tokensFromResponse(data: HubSpotTokenResponse, previous?: OAuthTokens): OAuthTokens {
  return {
    accessToken: data.access_token as string,
    refreshToken: data.refresh_token ?? previous?.refreshToken ?? null,
    expiresAt: new Date(Date.now() + (data.expires_in ?? 1800) * 1000).toISOString(),
    tokenType: "bearer",
  };
}

export async function exchangeHubSpotCode(
  config: HubSpotConfig,
  code: string,
  fetchImpl: FetchImpl = fetch,
): Promise<{ tokens: OAuthTokens; portalId: string | null }> {
  const data = await postTokenForm(
    config,
    {
      grant_type: "authorization_code",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      code,
    },
    fetchImpl,
  );
  return {
    tokens: tokensFromResponse(data),
    portalId: typeof data.hub_id === "number" ? String(data.hub_id) : null,
  };
}

// ---------------------------------------------------------------------
// Lead to contact mapping (pure)
// ---------------------------------------------------------------------

export interface MappableLead {
  email: string;
  fields: unknown;
}

/**
 * Maps a ColdReach lead to HubSpot contact properties. Pure, so the
 * mapping is unit tested without the API. Only fields that carry a
 * non-empty value are included; an update never blanks a property
 * the lead does not know about.
 */
export function leadToHubSpotProperties(lead: MappableLead): Record<string, string> {
  const fields: Record<string, unknown> =
    lead.fields && typeof lead.fields === "object" && !Array.isArray(lead.fields)
      ? (lead.fields as Record<string, unknown>)
      : {};
  const pick = (...keys: string[]): string | null => {
    for (const key of keys) {
      const value = fields[key];
      if (typeof value === "string" && value.trim().length > 0) {
        return value.trim();
      }
    }
    return null;
  };
  const properties: Record<string, string> = { email: lead.email };
  const firstName = pick("firstName", "first_name");
  if (firstName) properties.firstname = firstName;
  const lastName = pick("lastName", "last_name");
  if (lastName) properties.lastname = lastName;
  const company = pick("company", "organization");
  if (company) properties.company = company;
  const phone = pick("phone");
  if (phone) properties.phone = phone;
  const title = pick("role", "title", "jobTitle");
  if (title) properties.jobtitle = title;
  return properties;
}

// ---------------------------------------------------------------------
// Sync service
// ---------------------------------------------------------------------

export interface HubSpotSyncSummary {
  pushed: number;
  created: number;
  updated: number;
  failed: number;
  /** Always 0 today; see the module comment for why the pull is not
   *  part of this sync. Recorded so the limitation is visible in
   *  every stored run summary, not just in the docs. */
  pulledSuppressions: number;
  error: string | null;
  ranAt: string;
}

async function hubspotApi(
  accessToken: string,
  path: string,
  init: RequestInit,
  fetchImpl: FetchImpl,
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const response = await fetchImpl(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: response.ok, status: response.status, data };
}

async function findContactIdByEmail(
  accessToken: string,
  email: string,
  fetchImpl: FetchImpl,
): Promise<string | null> {
  const result = await hubspotApi(
    accessToken,
    "/crm/v3/objects/contacts/search",
    {
      method: "POST",
      body: JSON.stringify({
        filterGroups: [
          { filters: [{ propertyName: "email", operator: "EQ", value: email }] },
        ],
        properties: ["email"],
        limit: 1,
      }),
    },
    fetchImpl,
  );
  if (!result.ok) {
    throw new Error(`HubSpot contact search failed (HTTP ${result.status})`);
  }
  const results = result.data.results as { id?: string }[] | undefined;
  return results && results.length > 0 && results[0].id ? String(results[0].id) : null;
}

const REFRESH_SKEW_MS = 60_000;

async function getValidAccessToken(
  db: PrismaClient,
  connection: { id: string; encryptedCredentials: string | null },
  config: HubSpotConfig,
  fetchImpl: FetchImpl,
): Promise<string> {
  if (!connection.encryptedCredentials) {
    throw new Error("This HubSpot connection has no stored credentials. Reconnect it.");
  }
  const tokens = decryptOAuthTokens(connection.encryptedCredentials);
  const expiresAt = new Date(tokens.expiresAt).getTime();
  if (Number.isFinite(expiresAt) && expiresAt - Date.now() > REFRESH_SKEW_MS) {
    return tokens.accessToken;
  }
  if (!tokens.refreshToken) {
    throw new Error("The stored HubSpot credentials have no refresh token. Reconnect the account.");
  }
  const data = await postTokenForm(
    config,
    {
      grant_type: "refresh_token",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: tokens.refreshToken,
    },
    fetchImpl,
  );
  const fresh = tokensFromResponse(data, tokens);
  await db.crmConnection.update({
    where: { id: connection.id },
    data: { encryptedCredentials: encryptOAuthTokens(fresh) },
  });
  return fresh.accessToken;
}

const SYNC_BATCH_SIZE = 100;

/**
 * Pushes the workspace's leads to HubSpot as contacts (create or
 * update by email), in bounded batches, and records the run summary
 * on the connection. One lead's failure never aborts the run; it is
 * counted and the first error message is kept in the summary.
 */
export async function syncHubSpot(
  db: PrismaClient,
  workspaceId: string,
  options: { fetchImpl?: FetchImpl } = {},
): Promise<HubSpotSyncSummary> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const ranAt = new Date().toISOString();
  const config = getHubSpotConfig();
  if (!config) {
    throw Object.assign(
      new Error(`HubSpot is not configured on this server. Missing: ${hubspotMissingEnv().join(", ")}.`),
      { status: 501 },
    );
  }
  const connection = await db.crmConnection.findUnique({
    where: { workspaceId_provider: { workspaceId, provider: HUBSPOT_PROVIDER } },
  });
  if (!connection || connection.status !== "CONNECTED" || !connection.encryptedCredentials) {
    throw Object.assign(new Error("HubSpot is not connected for this workspace."), { status: 400 });
  }

  const summary: HubSpotSyncSummary = {
    pushed: 0,
    created: 0,
    updated: 0,
    failed: 0,
    pulledSuppressions: 0,
    error: null,
    ranAt,
  };

  try {
    const accessToken = await getValidAccessToken(db, connection, config, fetchImpl);
    let cursor: string | undefined;
    for (;;) {
      const batch = await db.lead.findMany({
        where: { workspaceId },
        select: { id: true, email: true, fields: true },
        orderBy: { id: "asc" },
        take: SYNC_BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (batch.length === 0) {
        break;
      }
      for (const lead of batch) {
        try {
          const properties = leadToHubSpotProperties(lead);
          const existingId = await findContactIdByEmail(accessToken, lead.email, fetchImpl);
          if (existingId) {
            const updated = await hubspotApi(
              accessToken,
              `/crm/v3/objects/contacts/${existingId}`,
              { method: "PATCH", body: JSON.stringify({ properties }) },
              fetchImpl,
            );
            if (!updated.ok) {
              throw new Error(`HubSpot contact update failed (HTTP ${updated.status})`);
            }
            summary.updated += 1;
          } else {
            const created = await hubspotApi(
              accessToken,
              "/crm/v3/objects/contacts",
              { method: "POST", body: JSON.stringify({ properties }) },
              fetchImpl,
            );
            if (!created.ok) {
              throw new Error(`HubSpot contact create failed (HTTP ${created.status})`);
            }
            summary.created += 1;
          }
          summary.pushed += 1;
        } catch (error) {
          summary.failed += 1;
          if (!summary.error) {
            summary.error = error instanceof Error ? error.message : "Sync failed for a lead";
          }
        }
      }
      cursor = batch[batch.length - 1].id;
      if (batch.length < SYNC_BATCH_SIZE) {
        break;
      }
    }
  } catch (error) {
    summary.error = error instanceof Error ? error.message : "HubSpot sync failed";
    logger.error("HubSpot sync failed", { error, workspaceId });
  }

  await db.crmConnection.update({
    where: { id: connection.id },
    data: {
      lastSyncAt: new Date(ranAt),
      lastSyncSummary: summary as unknown as object,
    },
  });
  return summary;
}
