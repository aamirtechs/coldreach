import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, requireSession } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";
import { validateAttachment } from "@/lib/attachments";

/**
 * Per-step campaign attachments (v1.19.0).
 *
 * Attachments belong to a step position (stepOrder) inside a
 * campaign, not to a SequenceStep row, because the sequence builder
 * replaces step rows wholesale on save. File bytes live in the
 * database (StepAttachment.data); these routes only ever return
 * metadata, never bytes. The download lives on the [attachmentId]
 * route. Rules (1 MB per file, 3 per step, format allowlist) are
 * enforced by src/lib/attachments.ts.
 */

const MAX_STEP_ORDER = 19; // A sequence may have at most 20 steps.

async function findCampaign(workspaceId: string, id: string) {
  return prisma.campaign.findFirst({
    where: { id, workspaceId },
    select: { id: true, status: true },
  });
}

function editGate(status: string): NextResponse | null {
  if (status === "RUNNING") {
    return NextResponse.json(
      { error: "Pause the campaign before editing its step attachments" },
      { status: 409 },
    );
  }
  if (status === "ARCHIVED") {
    return NextResponse.json({ error: "Archived campaigns cannot be edited" }, { status: 409 });
  }
  return null;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession("VIEWER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const { id } = await params;
  try {
    const campaign = await findCampaign(ctx.workspace.id, id);
    if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    const attachments = await prisma.stepAttachment.findMany({
      where: { campaignId: campaign.id, workspaceId: ctx.workspace.id },
      select: { id: true, stepOrder: true, filename: true, contentType: true, sizeBytes: true, createdAt: true },
      orderBy: [{ stepOrder: "asc" }, { createdAt: "asc" }],
    });
    return NextResponse.json({ attachments });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession("MEMBER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const { id } = await params;
  try {
    const campaign = await findCampaign(ctx.workspace.id, id);
    if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    const gate = editGate(campaign.status);
    if (gate) return gate;

    const form = await request.formData().catch(() => null);
    if (!form) {
      return NextResponse.json({ error: "Send the file as multipart form data" }, { status: 400 });
    }
    const stepOrderRaw = form.get("stepOrder");
    const stepOrder = typeof stepOrderRaw === "string" ? Number(stepOrderRaw) : NaN;
    if (!Number.isInteger(stepOrder) || stepOrder < 0 || stepOrder > MAX_STEP_ORDER) {
      return NextResponse.json({ error: "A valid step position is required" }, { status: 400 });
    }
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file was uploaded" }, { status: 400 });
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const existingCount = await prisma.stepAttachment.count({
      where: { campaignId: campaign.id, stepOrder },
    });
    const validation = validateAttachment({
      filename: file.name,
      sizeBytes: bytes.length,
      existingCount,
    });
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const created = await prisma.stepAttachment.create({
      data: {
        workspaceId: ctx.workspace.id,
        campaignId: campaign.id,
        stepOrder,
        filename: validation.filename,
        contentType: validation.contentType,
        sizeBytes: bytes.length,
        data: bytes,
      },
      select: { id: true, stepOrder: true, filename: true, contentType: true, sizeBytes: true, createdAt: true },
    });
    await writeAuditLog({
      action: "campaign.attachment_add",
      userId: ctx.user.id,
      workspaceId: ctx.workspace.id,
      metadata: {
        campaignId: campaign.id,
        stepOrder,
        filename: created.filename,
        sizeBytes: created.sizeBytes,
      },
    });
    return NextResponse.json({ attachment: created }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
