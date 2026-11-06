import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, requireSession } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";

/**
 * One step attachment (v1.19.0): download the stored bytes, or remove
 * the attachment. Both operations are scoped to the signed in
 * workspace and the campaign in the URL, so an attachment id from
 * another workspace is indistinguishable from a missing one.
 */

async function findAttachment(workspaceId: string, campaignId: string, attachmentId: string) {
  return prisma.stepAttachment.findFirst({
    where: { id: attachmentId, campaignId, workspaceId },
  });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; attachmentId: string }> },
) {
  const session = await requireSession("VIEWER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const { id, attachmentId } = await params;
  try {
    const attachment = await findAttachment(ctx.workspace.id, id, attachmentId);
    if (!attachment) return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
    const fallbackName = attachment.filename.replace(/[^\x20-\x7e]/g, "_");
    return new NextResponse(new Uint8Array(attachment.data), {
      headers: {
        "Content-Type": attachment.contentType,
        "Content-Length": String(attachment.sizeBytes),
        "Content-Disposition": `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; attachmentId: string }> },
) {
  const session = await requireSession("MEMBER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const { id, attachmentId } = await params;
  try {
    const campaign = await prisma.campaign.findFirst({
      where: { id, workspaceId: ctx.workspace.id },
      select: { id: true, status: true },
    });
    if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    if (campaign.status === "RUNNING") {
      return NextResponse.json(
        { error: "Pause the campaign before editing its step attachments" },
        { status: 409 },
      );
    }
    if (campaign.status === "ARCHIVED") {
      return NextResponse.json({ error: "Archived campaigns cannot be edited" }, { status: 409 });
    }
    const attachment = await findAttachment(ctx.workspace.id, id, attachmentId);
    if (!attachment) return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
    await prisma.stepAttachment.delete({ where: { id: attachment.id } });
    await writeAuditLog({
      action: "campaign.attachment_remove",
      userId: ctx.user.id,
      workspaceId: ctx.workspace.id,
      metadata: {
        campaignId: id,
        stepOrder: attachment.stepOrder,
        filename: attachment.filename,
        sizeBytes: attachment.sizeBytes,
      },
    });
    return NextResponse.json({ removed: true });
  } catch (error) {
    return apiError(error);
  }
}
