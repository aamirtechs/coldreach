import { SignJWT, jwtVerify } from "jose";

/**
 * OAuth state tokens for CRM connections.
 *
 * Same construction as the mailbox OAuth state in
 * src/lib/oauth/state.ts (short-lived signed JWT bound to the user
 * and workspace that started the flow), with a distinct purpose
 * claim so a mailbox state token can never be replayed against a
 * CRM callback or the other way round.
 */

function secretKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("SESSION_SECRET is missing or too short");
  }
  return new TextEncoder().encode(secret);
}

export async function createCrmState(input: {
  workspaceId: string;
  userId: string;
  provider: string;
}): Promise<string> {
  return new SignJWT({ wid: input.workspaceId, purpose: "crm-state", provider: input.provider })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(input.userId)
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(secretKey());
}

export interface CrmStateClaims {
  workspaceId: string;
  userId: string;
  provider: string;
}

export async function verifyCrmState(token: string): Promise<CrmStateClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (
      payload.purpose !== "crm-state" ||
      !payload.sub ||
      typeof payload.wid !== "string" ||
      typeof payload.provider !== "string"
    ) {
      return null;
    }
    return { workspaceId: payload.wid, userId: payload.sub, provider: payload.provider };
  } catch {
    return null;
  }
}
