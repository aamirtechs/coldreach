import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { apiError, intField, readJson, requireSession, stringField } from "@/lib/api";
import { isValidEmail, normalizeEmail } from "@/lib/domain/dedupe";
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
    let leads = await prisma.lead.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });
    // Tags live in a JSON array, so tag filtering happens after the
    // database query. Lists in this product are workspace sized; the
    // filter is exact and documented rather than approximate.
    if (tag) {
      leads = leads.filter(
        (lead) => Array.isArray(lead.tags) && lead.tags.map(String).includes(tag),
      );
    }
    const total = leads.length;
    const pageItems = leads.slice((page - 1) * pageSize, page * pageSize);

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

  const rawEmail = stringField(body.email);
  if (!isValidEmail(rawEmail)) {
    return NextResponse.json({ error: "A valid email address is required" }, { status: 400 });
  }
  const email = normalizeEmail(rawEmail);
  const fields: Record<string, string> = {};
  if (body.fields && typeof body.fields === "object" && !Array.isArray(body.fields)) {
    for (const [key, value] of Object.entries(body.fields)) {
      if (value !== null && value !== undefined && String(value).trim() !== "") {
        fields[key] = String(value);
      }
    }
  }
  // Convenience: firstName, lastName, company may also arrive top level.
  for (const key of ["firstName", "lastName", "company"] as const) {
    const value = stringField((body as Record<string, unknown>)[key]);
    if (value && !fields[key]) fields[key] = value;
  }
  const tags = Array.isArray(body.tags)
    ? body.tags.map((t) => String(t).trim()).filter(Boolean)
    : [];

  try {
    const listId = stringField(body.listId);
    if (listId) {
      const list = await prisma.leadList.findFirst({
        where: { id: listId, workspaceId: ctx.workspace.id },
        select: { id: true },
      });
      if (!list) return NextResponse.json({ error: "List not found" }, { status: 404 });
    }
    const existing = await prisma.lead.findUnique({
      where: { workspaceId_email: { workspaceId: ctx.workspace.id, email } },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json(
        { error: "A lead with this email already exists in the workspace" },
        { status: 409 },
      );
    }
    const lead = await prisma.lead.create({
      data: {
        workspaceId: ctx.workspace.id,
        listId: listId || null,
        email,
        fields,
        tags,
        status: "NEW",
      },
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
