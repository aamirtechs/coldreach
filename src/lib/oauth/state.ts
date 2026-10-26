import { SignJWT, jwtVerify } from "jose";
import type { OAuthProviderId } from "./config";

/**
 * OAuth state tokens.
 *
 * The state parameter round-trips through the provider's consent
 * screen, so it is a short-lived signed JWT (SESSION_SECRET) carrying
 * the workspace and user that started the flow. The callback verifies
 * the signature AND that the signed-in session matches the claims, so
 * a state token cannot be used to attach a mailbox to someone else's
 * workspace.
 */

function secretKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("SESSION_SECRET is missing or too short");
  }
  return new TextEncoder().encode(secret);
}

export async function createOAuthState(input: {
  workspaceId: string;
  userId: string;
  provider: OAuthProviderId;
}): Promise<string> {
  return new SignJWT({ wid: input.workspaceId, purpose: "oauth-state", provider: input.provider })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(input.userId)
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(secretKey());
}

export interface OAuthStateClaims {
  workspaceId: string;
  userId: string;
  provider: OAuthProviderId;
}

export async function verifyOAuthState(token: string): Promise<OAuthStateClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (
      payload.purpose !== "oauth-state" ||
      !payload.sub ||
      typeof payload.wid !== "string" ||
      (payload.provider !== "google" && payload.provider !== "microsoft")
    ) {
      return null;
    }
    return {
      workspaceId: payload.wid,
      userId: payload.sub,
      provider: payload.provider,
    };
  } catch {
    return null;
  }
}
