import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, readJson, requireSession, stringField } from "@/lib/api";
import { isValidEmail, normalizeEmail } from "@/lib/domain/dedupe";
import { withinSeatLimit } from "@/lib/domain/plans";
import { getPlanForWorkspace, getWorkspaceUsage } from "@/lib/billing/subscription";
import { createInvite, inviteState } from "@/lib/team/invites";
import { resolveProvider } from "@/lib/providers";
import { writeAuditLog } from "@/lib/audit";

const ROLES = ["OWNER", "ADMIN", "MEMBER", "VIEWER"] as const;

/** Pending invites for the active workspace (OWNER/ADMIN only). */
export async function GET() {
  const session = await requireSession("ADMIN");
  if ("error" in session) return session.error;
  const { ctx } = session;
  try {
    const invites = await prisma.invite.findMany({
      where: { workspaceId: ctx.workspace.id },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { invitedBy: { select: { name: true, email: true } } },
    });
    const now = new Date();
    return NextResponse.json({
      invites: invites.map((invite) => ({
        id: invite.id,
        email: invite.email,
        role: invite.role,
        state: inviteState(invite, now),
        expiresAt: invite.expiresAt,
        acceptedAt: invite.acceptedAt,
        invitedBy: invite.invitedBy,
        createdAt: invite.createdAt,
      })),
    });
  } catch (error) {
    return apiError(error);
  }
}

/**
 * Creates an invite and returns its accept link. When the workspace
 * has a connected SMTP account the invitation is also emailed through
 * it; otherwise (and whenever emailing fails) the link is returned for
 * the owner to share, so the flow never depends on email delivery.
 */
export async function POST(request: Request) {
  const session = await requireSession("ADMIN");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const body = await readJson<{ email?: unknown; role?: unknown }>(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const email = stringField(body.email);
  if (!isValidEmail(email)) {
    return NextResponse.json({ error: "A valid email is required" }, { status: 400 });
  }
  const role = stringField(body.role) || "MEMBER";
  if (!ROLES.includes(role as (typeof ROLES)[number])) {
    return NextResponse.json({ error: `Unknown role "${role}"` }, { status: 400 });
  }
  try {
    // Plan limit (Phase 4): seats are members plus live pending
    // invites, so an invite that would exceed the plan is refused at
    // creation, not discovered at acceptance.
    const [plan, usage] = await Promise.all([
      getPlanForWorkspace(prisma, ctx.workspace.id),
      getWorkspaceUsage(prisma, ctx.workspace.id),
    ]);
    if (!withinSeatLimit(plan, usage.seatsUsed)) {
      return NextResponse.json(
        {
          error: `The ${plan.name} plan allows ${plan.seats} seats and this workspace already uses ${usage.seatsUsed} (members plus pending invites). Upgrade in Billing to invite more people.`,
        },
        { status: 403 },
      );
    }
    const invite = await createInvite(prisma, {
      workspaceId: ctx.workspace.id,
      email: normalizeEmail(email),
      role: role as (typeof ROLES)[number],
      invitedById: ctx.user.id,
    });
    const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
    const acceptUrl = `${appUrl}${invite.acceptPath}`;

    let emailed = false;
    const smtpAccount = await prisma.sendingAccount.findFirst({
      where: { workspaceId: ctx.workspace.id, provider: "SMTP", status: "CONNECTED" },
      orderBy: { createdAt: "asc" },
    });
    if (smtpAccount) {
      try {
        const provider = await resolveProvider(smtpAccount, prisma);
        await provider.send({
          toEmail: invite.email,
          fromEmail: smtpAccount.email,
          fromName: smtpAccount.displayName ?? ctx.workspace.name,
          subject: `You are invited to ${ctx.workspace.name} on ColdReach`,
          text: `${ctx.user.name} invited you to join the "${ctx.workspace.name}" workspace on ColdReach as ${invite.role}.\n\nAccept the invitation: ${acceptUrl}\n\nThe link expires in 7 days. If you do not have an account yet, sign up with this email address first, then open the link again.`,
          html: `<p>${ctx.user.name} invited you to join the <strong>${ctx.workspace.name}</strong> workspace on ColdReach as ${invite.role}.</p><p><a href="${acceptUrl}">Accept the invitation</a></p><p>The link expires in 7 days. If you do not have an account yet, sign up with this email address first, then open the link again.</p>`,
        });
        emailed = true;
      } catch (error) {
        console.error("Invite email failed, returning the link instead", error);
      }
    }

    await writeAuditLog({
      action: "team.invite_create",
      userId: ctx.user.id,
      workspaceId: ctx.workspace.id,
      metadata: { inviteId: invite.id, email: invite.email, role: invite.role, emailed },
    });
    return NextResponse.json(
      { invite: { id: invite.id, email: invite.email, role: invite.role, expiresAt: invite.expiresAt }, acceptUrl, emailed },
      { status: 201 },
    );
  } catch (error) {
    return apiError(error);
  }
}
