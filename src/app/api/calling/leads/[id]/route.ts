import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { apiError, readJson, requireSession, stringField } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";
import { callingFieldsFromBody, mergeCallingFields } from "@/lib/calling/leadFields";

/**
 * Edit one call lead's details (v1.44.0). Updates the lead's fields
 * JSON in place: the basics (name, company, phone, website) plus the
 * enriched calling fields (location, timezone, best window,
 * decision maker, pain points, hook, score, personal script). An
 * empty string clears a field. The lead's email is not editable
 * here, because address changes carry dedupe and suppression
 * implications the Leads section already owns. Workspace scoped:
 * a lead from another workspace reads as not found.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession("MEMBER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const { id } = await params;
  const body = await readJson<Record<string, unknown>>(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

  const calling = callingFieldsFromBody(body);
  if ("error" in calling) {
    return NextResponse.json({ error: calling.error }, { status: 400 });
  }

  try {
    const lead = await prisma.lead.findFirst({
      where: { id, workspaceId: ctx.workspace.id },
      select: { id: true, email: true, listId: true, fields: true },
    });
    if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

    const existing =
      lead.fields && typeof lead.fields === "object" && !Array.isArray(lead.fields)
        ? (lead.fields as Record<string, unknown>)
        : {};
    const next: Record<string, unknown> = mergeCallingFields(existing, calling.fields);

    // Basics: only keys actually present in the body are touched.
    for (const key of ["phone", "company", "website"] as const) {
      if (body[key] === undefined) continue;
      const value = stringField(body[key]);
      if (value) next[key] = value;
      else delete next[key];
    }
    if (body.name !== undefined) {
      const name = stringField(body.name);
      const [firstName, ...rest] = name.split(/\s+/).filter(Boolean);
      if (firstName) next.firstName = firstName;
      else delete next.firstName;
      if (rest.length) next.lastName = rest.join(" ");
      else delete next.lastName;
    }
    if (typeof next.phone !== "string" || !next.phone) {
      return NextResponse.json(
        { error: "A call lead needs a phone number; add one instead of clearing it" },
        { status: 400 },
      );
    }

    const updated = await prisma.lead.update({
      where: { id: lead.id },
      data: { fields: next as Prisma.InputJsonValue },
      select: { id: true, email: true, listId: true, fields: true },
    });
    await writeAuditLog({
      action: "call_lead.update",
      userId: ctx.user.id,
      workspaceId: ctx.workspace.id,
      metadata: { leadId: lead.id },
    });
    return NextResponse.json({ lead: updated });
  } catch (error) {
    return apiError(error);
  }
}
