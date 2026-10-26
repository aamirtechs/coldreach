import { createHash, randomBytes } from "node:crypto";
import type { PrismaClient, Role } from "@prisma/client";
import { normalizeEmail } from "@/lib/domain/dedupe";

/**
 * Workspace invitation service.
 *
 * An invite is a random token; only its SHA-256 hash is stored, the
 * same discipline as unsubscribe tokens. Invites expire after 7 days.
 * Accepting requires being signed in with the invited email, which is
 * what binds the invite to a person rather than to whoever holds the
 * link alone.
 */

export const INVITE_TTL_DAYS = 7;

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export interface CreatedInvite {
  id: string;
  email: string;
  role: Role;
  expiresAt: Date;
  /** The one moment the raw token exists outside the invitee's link. */
  token: string;
  acceptPath: string;
}

export async function createInvite(
  db: PrismaClient,
  input: {
    workspaceId: string;
    email: string;
    role: Role;
    invitedById: string;
    now?: Date;
  },
): Promise<CreatedInvite> {
  const email = normalizeEmail(input.email);
  const now = input.now ?? new Date();

  const existingUser = await db.user.findUnique({ where: { email } });
  if (existingUser) {
    const membership = await db.membership.findFirst({
      where: { workspaceId: input.workspaceId, userId: existingUser.id },
    });
    if (membership) {
      throw Object.assign(new Error("That person is already a member of this workspace."), {
        status: 409,
      });
    }
  }

  // One live invite per email per workspace: a fresh invite supersedes
  // any pending one.
  await db.invite.updateMany({
    where: { workspaceId: input.workspaceId, email, acceptedAt: null },
    data: { expiresAt: now },
  });

  const token = generateToken();
  const expiresAt = new Date(now.getTime() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
  const invite = await db.invite.create({
    data: {
      workspaceId: input.workspaceId,
      email,
      role: input.role,
      tokenHash: hashInviteToken(token),
      expiresAt,
      invitedById: input.invitedById,
    },
  });
  return {
    id: invite.id,
    email: invite.email,
    role: invite.role,
    expiresAt: invite.expiresAt,
    token,
    acceptPath: `/invite/${token}`,
  };
}

export async function findInviteByToken(db: PrismaClient, token: string) {
  return db.invite.findUnique({
    where: { tokenHash: hashInviteToken(token) },
    include: { workspace: { select: { id: true, name: true } } },
  });
}

export type InviteState = "PENDING" | "ACCEPTED" | "EXPIRED";

export function inviteState(invite: { acceptedAt: Date | null; expiresAt: Date }, now = new Date()): InviteState {
  if (invite.acceptedAt) {
    return "ACCEPTED";
  }
  return invite.expiresAt <= now ? "EXPIRED" : "PENDING";
}

/**
 * Accepts an invite for the signed-in user. The user's email must
 * match the invited email; membership is created with the invited
 * role. Re-accepting an already accepted invite by the same member is
 * a no-op success, which keeps double clicks harmless.
 */
export async function acceptInvite(
  db: PrismaClient,
  input: { token: string; userId: string; userEmail: string; now?: Date },
): Promise<{ workspaceId: string; role: Role; alreadyMember: boolean }> {
  const now = input.now ?? new Date();
  const invite = await findInviteByToken(db, input.token);
  if (!invite) {
    throw Object.assign(new Error("This invitation link is not valid."), { status: 404 });
  }
  if (normalizeEmail(input.userEmail) !== invite.email) {
    throw Object.assign(
      new Error("Sign in with the email address this invitation was sent to."),
      { status: 403 },
    );
  }
  const existing = await db.membership.findFirst({
      where: { workspaceId: invite.workspaceId, userId: input.userId },
  });
  if (invite.acceptedAt) {
    if (existing) {
      return { workspaceId: invite.workspaceId, role: existing.role, alreadyMember: true };
    }
    throw Object.assign(new Error("This invitation has already been used."), { status: 409 });
  }
  if (invite.expiresAt <= now) {
    throw Object.assign(new Error("This invitation has expired. Ask for a new one."), {
      status: 410,
    });
  }
  const role = existing?.role ?? invite.role;
  await db.$transaction([
    ...(existing
      ? []
      : [
          db.membership.create({
            data: { workspaceId: invite.workspaceId, userId: input.userId, role: invite.role },
          }),
        ]),
    db.invite.update({ where: { id: invite.id }, data: { acceptedAt: now } }),
  ]);
  return { workspaceId: invite.workspaceId, role, alreadyMember: Boolean(existing) };
}

/** Extends a pending invite with a fresh token and expiry. */
export async function resendInvite(
  db: PrismaClient,
  input: { workspaceId: string; inviteId: string; now?: Date },
): Promise<CreatedInvite> {
  const now = input.now ?? new Date();
  const invite = await db.invite.findFirst({
    where: { id: input.inviteId, workspaceId: input.workspaceId },
  });
  if (!invite) {
    throw Object.assign(new Error("Invite not found"), { status: 404 });
  }
  if (invite.acceptedAt) {
    throw Object.assign(new Error("This invite was already accepted."), { status: 409 });
  }
  const token = generateToken();
  const expiresAt = new Date(now.getTime() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
  const updated = await db.invite.update({
    where: { id: invite.id },
    data: { tokenHash: hashInviteToken(token), expiresAt },
  });
  return {
    id: updated.id,
    email: updated.email,
    role: updated.role,
    expiresAt: updated.expiresAt,
    token,
    acceptPath: `/invite/${token}`,
  };
}

export async function countOwners(db: PrismaClient, workspaceId: string): Promise<number> {
  return db.membership.count({ where: { workspaceId, role: "OWNER" } });
}

/**
 * Changes a member's role. The last OWNER cannot be demoted: a
 * workspace must always keep at least one owner who can manage it.
 */
export async function changeMemberRole(
  db: PrismaClient,
  input: { workspaceId: string; userId: string; role: Role },
): Promise<void> {
  const member = await db.membership.findFirst({
      where: { workspaceId: input.workspaceId, userId: input.userId },
  });
  if (!member) {
    throw Object.assign(new Error("Member not found"), { status: 404 });
  }
  if (member.role === "OWNER" && input.role !== "OWNER") {
    const owners = await countOwners(db, input.workspaceId);
    if (owners <= 1) {
      throw Object.assign(
        new Error("The workspace needs at least one owner. Promote another member first."),
        { status: 409 },
      );
    }
  }
  await db.membership.update({
    where: { id: member.id },
    data: { role: input.role },
  });
}

/**
 * Removes a member. The last OWNER cannot be removed, for the same
 * reason as the demotion guard.
 */
export async function removeMember(
  db: PrismaClient,
  input: { workspaceId: string; userId: string },
): Promise<void> {
  const member = await db.membership.findFirst({
      where: { workspaceId: input.workspaceId, userId: input.userId },
  });
  if (!member) {
    throw Object.assign(new Error("Member not found"), { status: 404 });
  }
  if (member.role === "OWNER") {
    const owners = await countOwners(db, input.workspaceId);
    if (owners <= 1) {
      throw Object.assign(
        new Error("The last owner cannot be removed from the workspace."),
        { status: 409 },
      );
    }
  }
  await db.membership.delete({ where: { id: member.id } });
}
