import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { apiError, readJson, requireSession } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";
import { callLeadFromBody } from "@/lib/calling/callLeadFields";
import { sortCallLeads } from "@/lib/calling/statePriority";
import { shapeCallLead } from "@/lib/calling/callLeadShape";

const SCAN_LIMIT = 5000;
const DEFAULT_LIST_NAME = "Calling leads";

/**
 * The dedicated call leads (v1.47.0). Reads and writes ONLY the
 * CallLead model; the email Lead model is never touched here.
 * Filters: listId, serviceSlug, temperature. HOT leads sort first,
 * then by lead score, so the day's best calls sit at the top.
 */
export async function GET(request: Request) {
  const session = await requireSession("VIEWER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const params = new URL(request.url).searchParams;
  const listId = params.get("listId") ?? "";
  const serviceSlug = params.get("serviceSlug") ?? "";
  const temperature = params.get("temperature") ?? "";
  try {
    const [lists, leads] = await Promise.all([
      prisma.callLeadList.findMany({
        where: { workspaceId: ctx.workspace.id },
        orderBy: { name: "asc" },
        select: { id: true, name: true, serviceSlug: true, createdAt: true },
      }),
      prisma.callLead.findMany({
        where: {
          workspaceId: ctx.workspace.id,
          ...(listId ? { listId } : {}),
          ...(serviceSlug ? { serviceSlug } : {}),
          ...(temperature ? { temperature } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: SCAN_LIMIT,
      }),
    ]);
    const leadIds = leads.map((lead) => lead.id);
    const recentLogs = leadIds.length
      ? await prisma.callLog.findMany({
          where: { workspaceId: ctx.workspace.id, callLeadId: { in: leadIds } },
          orderBy: { calledAt: "desc" },
          select: { callLeadId: true, disposition: true, calledAt: true },
        })
      : [];
    const lastCallByLead = new Map<string, { disposition: string; calledAt: Date }>();
    for (const log of recentLogs) {
      if (log.callLeadId && !lastCallByLead.has(log.callLeadId)) {
        lastCallByLead.set(log.callLeadId, {
          disposition: log.disposition,
          calledAt: log.calledAt,
        });
      }
    }
    const shaped = leads.map((lead) => shapeCallLead(lead, lastCallByLead.get(lead.id) ?? null));
    // Default order (2026-11-21): state priority first (Georgia at
    // the top, held and blocked states last), then HOT before
    // WARM, then lead score descending. One helper, shared with
    // the UI and the future daily pipeline.
    const sorted = sortCallLeads(shaped);
    return NextResponse.json({
      lists: lists.map((list) => ({ ...list, leadCount: undefined })),
      leads: sorted,
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  const session = await requireSession("MEMBER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const body = await readJson<Record<string, unknown>>(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const parsed = callLeadFromBody(body);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const { lead } = parsed;
  try {
    let listId = lead.listId;
    if (listId) {
      const list = await prisma.callLeadList.findFirst({
        where: { id: listId, workspaceId: ctx.workspace.id },
        select: { id: true },
      });
      if (!list) return NextResponse.json({ error: "List not found" }, { status: 404 });
    } else {
      const newListName =
        typeof body.newListName === "string" && body.newListName.trim()
          ? body.newListName.trim()
          : DEFAULT_LIST_NAME;
      const list = await prisma.callLeadList.create({
        data: { workspaceId: ctx.workspace.id, name: newListName, serviceSlug: lead.serviceSlug },
        select: { id: true },
      });
      listId = list.id;
    }
    const created = await prisma.callLead.create({
      data: {
        workspaceId: ctx.workspace.id,
        listId,
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
      action: "call_lead.create",
      userId: ctx.user.id,
      workspaceId: ctx.workspace.id,
      metadata: { callLeadId: created.id, listId, serviceSlug: lead.serviceSlug },
    });
    return NextResponse.json({ lead: shapeCallLead(created) }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
