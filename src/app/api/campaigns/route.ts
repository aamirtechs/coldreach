import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, readJson, requireSession, stringField } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";

export async function GET() {
  const session = await requireSession("VIEWER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  try {
    const campaigns = await prisma.campaign.findMany({
      where: { workspaceId: ctx.workspace.id },
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { steps: true, enrollments: true } },
        leadList: { select: { id: true, name: true } },
      },
    });
    return NextResponse.json({
      campaigns: campaigns.map((campaign) => ({
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        timezone: campaign.timezone,
        leadList: campaign.leadList,
        stepCount: campaign._count.steps,
        enrollmentCount: campaign._count.enrollments,
        createdAt: campaign.createdAt,
      })),
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  const session = await requireSession("MEMBER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const body = await readJson<{ name?: unknown; leadListId?: unknown; timezone?: unknown }>(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const name = stringField(body.name);
  if (!name) return NextResponse.json({ error: "Campaign name is required" }, { status: 400 });
  try {
    const leadListId = stringField(body.leadListId);
    if (leadListId) {
      const list = await prisma.leadList.findFirst({
        where: { id: leadListId, workspaceId: ctx.workspace.id },
        select: { id: true },
      });
      if (!list) return NextResponse.json({ error: "Lead list not found" }, { status: 404 });
    }
    const timezone = stringField(body.timezone) || "UTC";
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    } catch {
      return NextResponse.json({ error: `Unknown timezone "${timezone}"` }, { status: 400 });
    }
    const campaign = await prisma.campaign.create({
      data: {
        workspaceId: ctx.workspace.id,
        name,
        leadListId: leadListId || null,
        timezone,
      },
    });
    await writeAuditLog({
      action: "campaign.create",
      userId: ctx.user.id,
      workspaceId: ctx.workspace.id,
      metadata: { campaignId: campaign.id, name: campaign.name },
    });
    return NextResponse.json({ campaign }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
