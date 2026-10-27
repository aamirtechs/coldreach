import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { apiError, intField, readJson, requireSession, stringField } from "@/lib/api";
import { createLead } from "@/lib/leads/createLead";
import { findSuppression } from "@/lib/domain/suppression";
import { loadSuppressions } from "@/lib/suppressions";
import { writeAuditLog } from "@/lib/audit";

const PAGE_SIZE_MAX = 200;

export async function GET(request: Request) {
  const session = await requireSession("VIEWER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const url = new URL(request.url);
  const listId = url.searchParams.get("listId") ?? undefined;
  const search = (url.searchParams.get("search") ?? "").trim();
  const status = (url.searchParams.get("status") ?? "").trim();
  const tag = (url.searchParams.get("tag") ?? "").trim();
  const page = Math.max(1, intField(url.searchParams.get("page"), 1));
  const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, intField(url.searchParams.get("pageSize"), 50)));

  const where: Prisma.LeadWhereInput = { workspaceId: ctx.workspace.id };
  if (listId) where.listId = listId;
  if (status) where.status = status as Prisma.EnumLeadStatusFilter["equals"];
  if (search) where.email = { contains: search.toLowerCase() };

  try {
    // Pagination happens in the database. The tag filter is the one
    // exception: tags live in a JSON array, so a tag query scans a
    // bounded window (TAG_SCAN_LIMIT newest leads) and filters in
    // memory; scanLimited in the response says when the window cut
    // the scan short, so the total is then a lower bound.
    const TAG_SCAN_LIMIT = 5000;
    let total: number;
    let pageItems: Awaited<ReturnType<typeof prisma.lead.findMany>>;
    let scanLimited = false;
    if (tag) {
      const scanned = await prisma.lead.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: TAG_SCAN_LIMIT,
      });
      scanLimited = scanned.length >= TAG_SCAN_LIMIT;
      const filtered = scanned.filter(
        (lead) => Array.isArray(lead.tags) && lead.tags.map(String).includes(tag),
      );
      total = filtered.length;
      pageItems = filtered.slice((page - 1) * pageSize, page * pageSize);
    } else {
      total = await prisma.lead.count({ where });
      pageItems = await prisma.lead.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      });
    }

    const suppressions = await loadSuppressions(prisma, ctx.workspace.id);
    return NextResponse.json({
      leads: pageItems.map((lead) => ({
        id: lead.id,
        email: lead.email,
        status: lead.status,
        listId: lead.listId,
        fields: lead.fields,
        tags: Array.isArray(lead.tags) ? lead.tags : [],
        suppressed: findSuppression(lead.email, suppressions) !== null,
        createdAt: lead.createdAt,
      })),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      scanLimited,
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  const session = await requireSession("MEMBER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const body = await readJson<{
    email?: unknown;
    listId?: unknown;
    fields?: unknown;
    tags?: unknown;
  }>(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

  try {
    // Creation rules live in the shared service so the public API
    // enforces exactly the same validation and dedupe.
    const lead = await createLead(prisma, ctx.workspace.id, {
      email: stringField(body.email),
      listId: stringField(body.listId) || null,
      fields:
        body.fields && typeof body.fields === "object" && !Array.isArray(body.fields)
          ? (body.fields as Record<string, unknown>)
          : null,
      firstName: (body as Record<string, unknown>).firstName,
      lastName: (body as Record<string, unknown>).lastName,
      company: (body as Record<string, unknown>).company,
      tags: Array.isArray(body.tags) ? body.tags : null,
    });
    await writeAuditLog({
      action: "lead.create",
      userId: ctx.user.id,
      workspaceId: ctx.workspace.id,
      metadata: { leadId: lead.id, listId: lead.listId },
    });
    return NextResponse.json({ lead }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
