import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import type { Membership, User, Workspace } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const SESSION_COOKIE = "coldreach_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

export type RoleValue = Membership["role"];

export interface SessionContext {
  user: User;
  workspace: Workspace;
  role: RoleValue;
}

function secretKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("SESSION_SECRET is missing or too short");
  }
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(userId: string, workspaceId: string): Promise<string> {
  return new SignJWT({ wid: workspaceId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secretKey());
}

export interface SessionClaims {
  userId: string;
  workspaceId: string | null;
}

export async function verifySessionToken(token: string): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (!payload.sub) {
      return null;
    }
    return {
      userId: payload.sub,
      workspaceId: typeof payload.wid === "string" ? payload.wid : null,
    };
  } catch {
    return null;
  }
}

export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
    secure: process.env.NODE_ENV === "production",
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
    secure: process.env.NODE_ENV === "production",
  });
}

/**
 * Resolves the signed-in user and their active workspace from the session
 * cookie. Returns null when there is no valid session. Every data query in
 * the app must scope by the returned workspace id; that scoping is what
 * enforces tenant isolation.
 */
export async function getSessionWorkspace(): Promise<SessionContext | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) {
    return null;
  }
  const claims = await verifySessionToken(token);
  if (!claims) {
    return null;
  }

  const membership = await prisma.membership.findFirst({
    where: {
      userId: claims.userId,
      ...(claims.workspaceId ? { workspaceId: claims.workspaceId } : {}),
    },
    include: { user: true, workspace: true },
    orderBy: { createdAt: "asc" },
  });
  if (!membership) {
    return null;
  }
  return { user: membership.user, workspace: membership.workspace, role: membership.role };
}

const ROLE_RANK: Record<RoleValue, number> = {
  VIEWER: 0,
  MEMBER: 1,
  ADMIN: 2,
  OWNER: 3,
};

/**
 * Asserts that the session role is at least the required role.
 * Throws an error with a 403 status property when it is not.
 */
export function requireRole(ctx: SessionContext, minimum: RoleValue): SessionContext {
  if (ROLE_RANK[ctx.role] < ROLE_RANK[minimum]) {
    const error = new Error(`This action requires the ${minimum} role`) as Error & {
      status?: number;
    };
    error.status = 403;
    throw error;
  }
  return ctx;
}
