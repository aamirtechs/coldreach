import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { dropTestDb, freshTestDb, seedWorkspace } from "@/lib/testing/testDb";
import {
  acceptInvite,
  changeMemberRole,
  createInvite,
  findInviteByToken,
  inviteState,
  removeMember,
} from "./invites";

const DB_NAME = "test-invites";
let db: PrismaClient;
let workspaceId: string;
let ownerId: string;

beforeAll(async () => {
  db = freshTestDb(DB_NAME);
  const seeded = await seedWorkspace(db, "invites");
  workspaceId = seeded.workspace.id;
  ownerId = seeded.user.id;
});

afterAll(async () => {
  await dropTestDb(db, DB_NAME);
});

describe("invite flow", () => {
  it("creates an invite whose raw token is never stored", async () => {
    const invite = await createInvite(db, {
      workspaceId,
      email: "Teammate@Example.com",
      role: "MEMBER",
      invitedById: ownerId,
    });
    expect(invite.email).toBe("teammate@example.com");
    expect(invite.acceptPath).toBe(`/invite/${invite.token}`);
    const stored = await db.invite.findUniqueOrThrow({ where: { id: invite.id } });
    expect(stored.tokenHash).not.toBe(invite.token);
    expect(stored.tokenHash).toHaveLength(64);
    const found = await findInviteByToken(db, invite.token);
    expect(found?.id).toBe(invite.id);
    expect(inviteState(found as never)).toBe("PENDING");
  });

  it("accepting joins the workspace with the invited role", async () => {
    const invite = await createInvite(db, {
      workspaceId,
      email: "second@example.com",
      role: "ADMIN",
      invitedById: ownerId,
    });
    const user = await db.user.create({
      data: { name: "Second", email: "second@example.com", passwordHash: "x" },
    });
    const result = await acceptInvite(db, {
      token: invite.token,
      userId: user.id,
      userEmail: "second@example.com",
    });
    expect(result.role).toBe("ADMIN");
    expect(result.alreadyMember).toBe(false);
    const membership = await db.membership.findFirst({
      where: { workspaceId, userId: user.id },
    });
    expect(membership?.role).toBe("ADMIN");
    const stored = await db.invite.findUniqueOrThrow({ where: { id: invite.id } });
    expect(stored.acceptedAt).not.toBeNull();

    const again = await acceptInvite(db, {
      token: invite.token,
      userId: user.id,
      userEmail: "second@example.com",
    });
    expect(again.alreadyMember).toBe(true);
  });

  it("rejects acceptance from a different email than invited", async () => {
    const invite = await createInvite(db, {
      workspaceId,
      email: "third@example.com",
      role: "MEMBER",
      invitedById: ownerId,
    });
    const other = await db.user.create({
      data: { name: "Other", email: "other@example.com", passwordHash: "x" },
    });
    await expect(
      acceptInvite(db, { token: invite.token, userId: other.id, userEmail: "other@example.com" }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("rejects an expired invite", async () => {
    const invite = await createInvite(db, {
      workspaceId,
      email: "late@example.com",
      role: "MEMBER",
      invitedById: ownerId,
    });
    await db.invite.update({
      where: { id: invite.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    const user = await db.user.create({
      data: { name: "Late", email: "late@example.com", passwordHash: "x" },
    });
    await expect(
      acceptInvite(db, { token: invite.token, userId: user.id, userEmail: "late@example.com" }),
    ).rejects.toMatchObject({ status: 410 });
    expect(await db.membership.findFirst({ where: { workspaceId, userId: user.id } })).toBeNull();
  });

  it("refuses inviting someone who is already a member", async () => {
    await expect(
      createInvite(db, {
        workspaceId,
        email: "second@example.com",
        role: "MEMBER",
        invitedById: ownerId,
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe("last owner guards", () => {
  it("cannot demote or remove the only owner, but can once a second owner exists", async () => {
    await expect(
      changeMemberRole(db, { workspaceId, userId: ownerId, role: "ADMIN" }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(removeMember(db, { workspaceId, userId: ownerId })).rejects.toMatchObject({
      status: 409,
    });

    const second = await db.user.create({
      data: { name: "Owner Two", email: "owner2@example.com", passwordHash: "x" },
    });
    await db.membership.create({
      data: { workspaceId, userId: second.id, role: "OWNER" },
    });
    await changeMemberRole(db, { workspaceId, userId: ownerId, role: "ADMIN" });
    const demoted = await db.membership.findFirst({ where: { workspaceId, userId: ownerId } });
    expect(demoted?.role).toBe("ADMIN");
    await removeMember(db, { workspaceId, userId: ownerId });
    expect(await db.membership.findFirst({ where: { workspaceId, userId: ownerId } })).toBeNull();
  });
});
