import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { apiError, intField, readJson, stringField } from "@/lib/api";
import { requireApiKey } from "@/lib/apiKeys/auth";
import { createLead } from "@/lib/leads/createLead";
import { findSuppression } from "@/lib/domain/suppression";
import { loadSuppressions } from "@/lib/suppressions";

/**
 * Public API: leads. Authenticated by API key (see API.md). The
 * workspace always comes from the key, never from the request.
 */

const PAGE_SIZE_MAX = 200;

export async function GET(request: Request) {
  const auth = await requireApiKey(request, "leads:read");
  if ("error" in auth) return auth.error;
  const { ctx } = auth;
  const url = new URL(request.url);
  const listId = url.searchParams.get("listId") ?? undefined;
  const search = (url.searchParams.get("search") ?? "").trim();
  const status = (url.searchParams.get("status") ?? "").trim();
  const page = Math.max(1, intField(url.searchParams.get("page"), 1));
  const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, intField(url.searchParams.get("pageSize"), 50)));

  const where: Prisma.LeadWhereInput = { workspaceId: ctx.workspaceId };
  if (listId) where.listId = listId;
  if (status) where.status = status as Prisma.EnumLeadStatusFilter["equals"];
  if (search) where.email = { contains: search.toLowerCase() };

  try {
    const [total, leads] = await Promise.all([
      prisma.lead.count({ where }),
      prisma.lead.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    const suppressions = await loadSuppressions(prisma, ctx.workspaceId);
    return NextResponse.json({
      leads: leads.map((lead) => ({
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
  const auth = await requireApiKey(request, "leads:write");
  if ("error" in auth) return auth.error;
  const { ctx } = auth;
  const body = await readJson<{
    email?: unknown;
    listId?: unknown;
    fields?: unknown;
    tags?: unknown;
  }>(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  try {
    const lead = await createLead(prisma, ctx.workspaceId, {
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
      rejectSuppressed: true,
    });
    return NextResponse.json(
      {
        lead: {
          id: lead.id,
          email: lead.email,
          status: lead.status,
          listId: lead.listId,
          fields: lead.fields,
          tags: Array.isArray(lead.tags) ? lead.tags : [],
          createdAt: lead.createdAt,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    return apiError(error);
  }
}
