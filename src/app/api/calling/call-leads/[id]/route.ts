import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { apiError, readJson, requireSession } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";
import { callLeadFromBody, verifyFromBody } from "@/lib/calling/callLeadFields";
import { shapeCallLead } from "@/lib/calling/callLeadShape";

/**
 * Edit, verify or delete one call lead (v1.47.0). When the body
 * carries a verifyStatus, the request is the manual verification
 * action: it sets the status and note, and stamps verifiedAt when
 * the lead is marked VERIFIED. Otherwise the body is a full lead
 * edit through the same validation as create. Workspace scoped
 * throughout: a foreign id reads as not found.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession("MEMBER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const { id } = await params;
  const body = await readJson<Record<string, unknown>>(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  try {
    const existing = await prisma.callLead.findFirst({
      where: { id, workspaceId: ctx.workspace.id },
      select: { id: true },
    });
    if (!existing) return NextResponse.json({ error: "Call lead not found" }, { status: 404 });

    if (body.verifyStatus !== undefined) {
      const verify = verifyFromBody(body);
      if ("error" in verify) {
        return NextResponse.json({ error: verify.error }, { status: 400 });
      }
      const updated = await prisma.callLead.update({
        where: { id },
        data: {
          verifyStatus: verify.verifyStatus,
          verifyNote: verify.verifyNote,
          verifiedAt: verify.verifyStatus === "VERIFIED" ? new Date() : null,
        },
      });
      await writeAuditLog({
        action: "call_lead.verify",
        userId: ctx.user.id,
        workspaceId: ctx.workspace.id,
        metadata: { callLeadId: id, verifyStatus: verify.verifyStatus },
      });
      return NextResponse.json({ lead: shapeCallLead(updated) });
    }

    const parsed = callLeadFromBody(body);
    if ("error" in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const { lead } = parsed;
    if (lead.listId) {
      const list = await prisma.callLeadList.findFirst({
        where: { id: lead.listId, workspaceId: ctx.workspace.id },
        select: { id: true },
      });
      if (!list) return NextResponse.json({ error: "List not found" }, { status: 404 });
    }
    const updated = await prisma.callLead.update({
      where: { id },
      data: {
        listId: lead.listId,
        serviceSlug: lead.serviceSlug,
        temperature: lead.temperature,
        leadScore: lead.leadScore,
        firstName: lead.firstName,
        lastName: lead.lastName,
        company: lead.company,
        phone: lead.phone,
        email: lead.email,
        website: lead.website,
        city: lead.city,
        state: lead.state,
        timezone: lead.timezone,
        decisionMaker: lead.decisionMaker,
        namePronunciation: lead.namePronunciation,
        fields: lead.fields as Prisma.InputJsonValue,
      },
    });
    await writeAuditLog({
      action: "call_lead.update",
      userId: ctx.user.id,
      workspaceId: ctx.workspace.id,
      metadata: { callLeadId: id },
    });
    return NextResponse.json({ lead: shapeCallLead(updated) });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession("MEMBER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const { id } = await params;
  try {
    const existing = await prisma.callLead.findFirst({
      where: { id, workspaceId: ctx.workspace.id },
      select: { id: true },
    });
    if (!existing) return NextResponse.json({ error: "Call lead not found" }, { status: 404 });
    await prisma.callLead.delete({ where: { id } });
    await writeAuditLog({
      action: "call_lead.delete",
      userId: ctx.user.id,
      workspaceId: ctx.workspace.id,
      metadata: { callLeadId: id },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
