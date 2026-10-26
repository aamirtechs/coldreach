import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, intField, readJson, requireSession, stringField } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";

interface StepInput {
  subject?: unknown;
  body?: unknown;
  delayDays?: unknown;
  delayHours?: unknown;
}

/**
 * Replaces the campaign's whole sequence atomically. The builder edits
 * an ordered list client-side and saves it in one call, which keeps the
 * unique (campaignId, order) constraint trivially satisfied.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession("MEMBER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const { id } = await params;
  const body = await readJson<{ steps?: unknown }>(request);
  if (!body || !Array.isArray(body.steps)) {
    return NextResponse.json({ error: "A steps array is required" }, { status: 400 });
  }
  if (body.steps.length > 20) {
    return NextResponse.json({ error: "A sequence may have at most 20 steps" }, { status: 400 });
  }
  const steps = (body.steps as StepInput[]).map((step, index) => ({
    order: index,
    subject: stringField(step.subject),
    body: typeof step.body === "string" ? step.body : "",
    delayDays: Math.max(0, intField(step.delayDays, 0)),
    delayHours: Math.max(0, intField(step.delayHours, 0)),
  }));
  try {
    const campaign = await prisma.campaign.findFirst({
      where: { id, workspaceId: ctx.workspace.id },
      select: { id: true, status: true },
    });
    if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    if (campaign.status === "RUNNING") {
      return NextResponse.json(
        { error: "Pause the campaign before editing its sequence" },
        { status: 409 },
      );
    }
    if (campaign.status === "ARCHIVED") {
      return NextResponse.json({ error: "Archived campaigns cannot be edited" }, { status: 409 });
    }
    const saved = await prisma.$transaction(async (tx) => {
      await tx.sequenceStep.deleteMany({ where: { campaignId: campaign.id } });
      if (steps.length > 0) {
        await tx.sequenceStep.createMany({
          data: steps.map((step) => ({ ...step, campaignId: campaign.id })),
        });
      }
      return tx.sequenceStep.findMany({
        where: { campaignId: campaign.id },
        orderBy: { order: "asc" },
      });
    });
    await writeAuditLog({
      action: "campaign.steps_update",
      userId: ctx.user.id,
      workspaceId: ctx.workspace.id,
      metadata: { campaignId: campaign.id, stepCount: saved.length },
    });
    return NextResponse.json({ steps: saved });
  } catch (error) {
    return apiError(error);
  }
}
