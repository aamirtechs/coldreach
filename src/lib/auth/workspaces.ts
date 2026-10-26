import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Workspace listing and membership checks behind the topbar switcher.
 * Kept separate from the session module so the switch logic is unit
 * testable without cookies: switching verifies membership here, then
 * the API route re-issues the session token with the new workspace
 * claim (the session itself carries exactly one active workspace).
 */

export interface UserWorkspace {
  id: string;
  name: string;
  role: string;
}

export async function listUserWorkspaces(
  userId: string,
  db: PrismaClient = prisma,
): Promise<UserWorkspace[]> {
  const memberships = await db.membership.findMany({
    where: { userId },
    include: { workspace: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
  return memberships.map((membership) => ({
    id: membership.workspace.id,
    name: membership.workspace.name,
    role: membership.role,
  }));
}

export async function assertMembership(
  userId: string,
  workspaceId: string,
  db: PrismaClient = prisma,
): Promise<UserWorkspace> {
  const membership = await db.membership.findFirst({
    where: { workspaceId, userId },
    include: { workspace: { select: { id: true, name: true } } },
  });
  if (!membership) {
    throw Object.assign(new Error("You are not a member of that workspace."), { status: 403 });
  }
  return { id: membership.workspace.id, name: membership.workspace.name, role: membership.role };
}
