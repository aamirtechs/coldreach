import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildHubSpotAuthorizeUrl,
  getHubSpotConfig,
  hubspotConfigured,
  hubspotMissingEnv,
  leadToHubSpotProperties,
  syncHubSpot,
} from "./hubspot";
import { createCrmState, verifyCrmState } from "./state";
import { decryptOAuthTokens, encryptOAuthTokens } from "@/lib/security/crypto";

const ENV = {
  HUBSPOT_CLIENT_ID: "hs-client-id",
  HUBSPOT_CLIENT_SECRET: "hs-client-secret",
  APP_URL: "https://app.example.com",
};

describe("HubSpot config gating", () => {
  it("names every missing variable, exactly like the other providers", () => {
    expect(hubspotMissingEnv({} as NodeJS.ProcessEnv)).toEqual(["HUBSPOT_CLIENT_ID", "HUBSPOT_CLIENT_SECRET"]);
    expect(hubspotMissingEnv({ HUBSPOT_CLIENT_ID: "x" } as unknown as NodeJS.ProcessEnv)).toEqual(["HUBSPOT_CLIENT_SECRET"]);
    expect(hubspotMissingEnv(ENV as unknown as NodeJS.ProcessEnv)).toEqual([]);
    expect(hubspotConfigured({} as NodeJS.ProcessEnv)).toBe(false);
    expect(hubspotConfigured(ENV as unknown as NodeJS.ProcessEnv)).toBe(true);
  });

  it("builds an authorize URL with the contacts scopes and callback", () => {
    const config = getHubSpotConfig(ENV as unknown as NodeJS.ProcessEnv);
    expect(config).not.toBeNull();
    const url = new URL(buildHubSpotAuthorizeUrl(config!, "state-token"));
    expect(url.origin + url.pathname).toBe("https://app.hubspot.com/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("hs-client-id");
    expect(url.searchParams.get("redirect_uri")).toMatch(/\/api\/crm\/hubspot\/callback$/);
    expect(url.searchParams.get("scope")).toBe(
      "crm.objects.contacts.read crm.objects.contacts.write",
    );
    expect(url.searchParams.get("state")).toBe("state-token");
    expect(getHubSpotConfig({} as NodeJS.ProcessEnv)).toBeNull();
  });

  it("sync refuses with a 501 naming the missing variables when unconfigured", async () => {
    // The test environment carries no HUBSPOT_* variables, so the
    // config gate fires before any database access.
    expect(hubspotConfigured()).toBe(false);
    await expect(syncHubSpot(null as never, "ws")).rejects.toMatchObject({ status: 501 });
    await expect(syncHubSpot(null as never, "ws")).rejects.toThrow(/HUBSPOT_CLIENT_ID/);
  });
});

describe("leadToHubSpotProperties", () => {
  it("maps the standard fields including the import aliases", () => {
    expect(
      leadToHubSpotProperties({
        email: "ada@acme.com",
        fields: {
          firstName: "Ada",
          lastName: "Lovelace",
          company: "Acme",
          phone: "+1 555 0100",
          title: "CTO",
        },
      }),
    ).toEqual({
      email: "ada@acme.com",
      firstname: "Ada",
      lastname: "Lovelace",
      company: "Acme",
      phone: "+1 555 0100",
      jobtitle: "CTO",
    });
    expect(
      leadToHubSpotProperties({
        email: "grace@acme.com",
        fields: { first_name: "Grace", organization: "Acme", role: "VP Sales" },
      }),
    ).toEqual({
      email: "grace@acme.com",
      firstname: "Grace",
      company: "Acme",
      jobtitle: "VP Sales",
    });
  });

  it("omits empty and non-string values rather than blanking properties", () => {
    expect(
      leadToHubSpotProperties({ email: "a@acme.com", fields: { firstName: "  ", phone: 12345 } }),
    ).toEqual({ email: "a@acme.com" });
    expect(leadToHubSpotProperties({ email: "a@acme.com", fields: {} })).toEqual({
      email: "a@acme.com",
    });
    expect(leadToHubSpotProperties({ email: "a@acme.com", fields: null })).toEqual({
      email: "a@acme.com",
    });
  });
});

describe("CRM OAuth state", () => {
  const ORIGINAL_SECRET = process.env.SESSION_SECRET;
  beforeEach(() => {
    process.env.SESSION_SECRET = "test-session-secret-that-is-long-enough-0123456789";
  });
  afterEach(() => {
    if (ORIGINAL_SECRET === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = ORIGINAL_SECRET;
  });

  it("round-trips user and workspace and rejects tampering", async () => {
    const state = await createCrmState({ provider: "hubspot", userId: "user-1", workspaceId: "ws-1" });
    await expect(verifyCrmState(state)).resolves.toMatchObject({
      provider: "hubspot",
      userId: "user-1",
      workspaceId: "ws-1",
    });
    await expect(verifyCrmState(`${state}x`)).resolves.toBeNull();
    await expect(verifyCrmState("not-a-token")).resolves.toBeNull();
  });
});

describe("token storage through the existing OAuth crypto helper", () => {
  const ORIGINAL_KEY = process.env.ENCRYPTION_KEY;
  beforeEach(() => {
    // Deterministic 32-byte key for the round-trip only.
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  });
  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = ORIGINAL_KEY;
  });

  it("encrypts HubSpot tokens at rest and decrypts them back", () => {
    const tokens = {
      accessToken: "pat-access-token",
      refreshToken: "refresh-token",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      scope: "crm.objects.contacts.read crm.objects.contacts.write",
      tokenType: "bearer",
    };
    const encrypted = encryptOAuthTokens(tokens);
    expect(encrypted).not.toContain("pat-access-token");
    expect(decryptOAuthTokens(encrypted)).toEqual(tokens);
    const fetchSpy = vi.fn();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
