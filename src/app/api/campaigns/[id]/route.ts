import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, readJson, requireSession, stringField } from "@/lib/api";
import { enrollCampaign } from "@/lib/campaigns/enroll";
import { writeAuditLog } from "@/lib/audit";

async function loadCampaign(workspaceId: string, id: string) {
  return prisma.campaign.findFirst({
    where: { id, workspaceId },
    include: {
      steps: { orderBy: { order: "asc" } },
      accounts: { include: { sendingAccount: true } },
      leadList: { select: { id: true, name: true } },
      _count: { select: { enrollments: true } },
    },
  });
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession("VIEWER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const { id } = await params;
  try {
    const campaign = await loadCampaign(ctx.workspace.id, id);
    if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    return NextResponse.json({
      campaign: {
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        timezone: campaign.timezone,
        windowStart: campaign.windowStart,
        windowEnd: campaign.windowEnd,
        businessDaysOnly: campaign.businessDaysOnly,
        signatureText: campaign.signatureText,
        leadList: campaign.leadList,
        enrollmentCount: campaign._count.enrollments,
        createdAt: campaign.createdAt,
      },
      steps: campaign.steps,
      accounts: campaign.accounts.map((entry) => ({
        id: entry.sendingAccount.id,
        email: entry.sendingAccount.email,
        displayName: entry.sendingAccount.displayName,
        provider: entry.sendingAccount.provider,
        status: entry.sendingAccount.status,
        dailyLimit: entry.sendingAccount.dailyLimit,
        warmupStatus: entry.sendingAccount.warmupStatus,
      })),
    });
  } catch (error) {
    return apiError(error);
  }
}

interface PatchBody {
  name?: unknown;
  leadListId?: unknown;
  timezone?: unknown;
  windowStart?: unknown;
  windowEnd?: unknown;
  businessDaysOnly?: unknown;
  signatureText?: unknown;
  accountIds?: unknown;
  status?: unknown;
}

const WINDOW_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession("MEMBER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const { id } = await params;
  const body = await readJson<PatchBody>(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  try {
    const campaign = await loadCampaign(ctx.workspace.id, id);
    if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    if (campaign.status === "ARCHIVED") {
      return NextResponse.json({ error: "Archived campaigns cannot be edited" }, { status: 409 });
    }

    // Status transitions handled here are the safe ones. Entering
    // RUNNING only happens through the launch endpoint, which enforces
    // preflight.
    const targetStatus = stringField(body.status);
    if (targetStatus) {
      const allowed: Record<string, string[]> = {
        SCHEDULED: ["DRAFT", "PAUSED"],
        PAUSED: ["RUNNING", "SCHEDULED"],
        ARCHIVED: ["DRAFT", "SCHEDULED", "PAUSED"],
        DRAFT: ["PAUSED", "SCHEDULED"],
      };
      if (targetStatus === "RUNNING") {
        return NextResponse.json(
          { error: "Use the launch action to start a campaign; it enforces preflight" },
          { status: 400 },
        );
      }
      const from = allowed[targetStatus];
      if (!from || !from.includes(campaign.status)) {
        return NextResponse.json(
          { error: `Cannot move a ${campaign.status} campaign to ${targetStatus}` },
          { status: 409 },
        );
      }
      if (targetStatus === "SCHEDULED") {
        if (campaign.steps.length === 0) {
          return NextResponse.json(
            { error: "Add at least one sequence step before scheduling" },
            { status: 400 },
          );
        }
        if (!campaign.leadList) {
          return NextResponse.json(
            { error: "Attach a lead list before scheduling" },
            { status: 400 },
          );
        }
      }
      const updated = await prisma.campaign.update({
        where: { id: campaign.id },
        data: { status: targetStatus as typeof campaign.status },
      });
      await writeAuditLog({
        action: "campaign.status",
        userId: ctx.user.id,
        workspaceId: ctx.workspace.id,
        metadata: { campaignId: campaign.id, from: campaign.status, to: targetStatus },
      });
      return NextResponse.json({ campaign: updated });
    }

    const data: Record<string, unknown> = {};
    const name = stringField(body.name);
    if (name) data.name = name;
    if (body.timezone !== undefined) {
      const timezone = stringField(body.timezone);
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: timezone });
      } catch {
        return NextResponse.json({ error: `Unknown timezone "${timezone}"` }, { status: 400 });
      }
      data.timezone = timezone;
    }
    for (const key of ["windowStart", "windowEnd"] as const) {
      if (body[key] !== undefined) {
        const value = stringField(body[key]);
        if (!WINDOW_PATTERN.test(value)) {
          return NextResponse.json({ error: `${key} must be "HH:MM" 24 hour` }, { status: 400 });
        }
        data[key] = value;
      }
    }
    if (body.businessDaysOnly !== undefined) {
      data.businessDaysOnly = body.businessDaysOnly === true;
    }
    if (body.signatureText !== undefined) {
      // Signature is free text printed under every email this
      // campaign sends. An empty value clears it back to no
      // signature (the compliance footer always remains).
      const signature = typeof body.signatureText === "string" ? body.signatureText.trim() : "";
      if (signature.length > 2000) {
        return NextResponse.json({ error: "signatureText must be 2000 characters or fewer" }, { status: 400 });
      }
      data.signatureText = signature === "" ? null : signature;
    }
    let listChanged = false;
    if (body.leadListId !== undefined) {
      const leadListId = stringField(body.leadListId);
      if (leadListId) {
        const list = await prisma.leadList.findFirst({
          where: { id: leadListId, workspaceId: ctx.workspace.id },
          select: { id: true },
        });
        if (!list) return NextResponse.json({ error: "Lead list not found" }, { status: 404 });
        data.leadListId = leadListId;
      } else {
        data.leadListId = null;
      }
      listChanged = data.leadListId !== campaign.leadList?.id;
    }

    const updated = await prisma.campaign.update({ where: { id: campaign.id }, data });

    if (Array.isArray(body.accountIds)) {
      const accountIds = body.accountIds.map(String);
      const owned = await prisma.sendingAccount.findMany({
        where: { workspaceId: ctx.workspace.id, id: { in: accountIds } },
        select: { id: true },
      });
      if (owned.length !== accountIds.length) {
        return NextResponse.json(
          { error: "One or more sending accounts were not found in this workspace" },
          { status: 400 },
        );
      }
      await prisma.$transaction([
        prisma.campaignAccount.deleteMany({ where: { campaignId: campaign.id } }),
        prisma.campaignAccount.createMany({
          data: owned.map((account) => ({
            campaignId: campaign.id,
            sendingAccountId: account.id,
          })),
        }),
      ]);
    }

    // When the attached list changes, enroll the new list's leads so
    // preflight sees real numbers. Enrollment is idempotent: leads
    // already enrolled are counted as skipped duplicates.
    let enrollment: Awaited<ReturnType<typeof enrollCampaign>> | null = null;
    if (listChanged && updated.leadListId) {
      enrollment = await enrollCampaign(prisma, {
        workspaceId: ctx.workspace.id,
        campaignId: campaign.id,
      });
    }

    return NextResponse.json({ campaign: updated, enrollment });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession("ADMIN");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const { id } = await params;
  try {
    const campaign = await prisma.campaign.findFirst({
      where: { id, workspaceId: ctx.workspace.id },
      select: { id: true, name: true, status: true },
    });
    if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    if (campaign.status === "RUNNING") {
      return NextResponse.json(
        { error: "Pause the campaign before deleting it" },
        { status: 409 },
      );
    }
    await prisma.campaign.delete({ where: { id: campaign.id } });
    await writeAuditLog({
      action: "campaign.delete",
      userId: ctx.user.id,
      workspaceId: ctx.workspace.id,
      metadata: { campaignId: campaign.id, name: campaign.name },
    });
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return apiError(error);
  }
}
