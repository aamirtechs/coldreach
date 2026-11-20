import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, readJson, requireSession, stringField } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";
import { createLead } from "@/lib/leads/createLead";
import { callingFieldsFromBody } from "@/lib/calling/leadFields";

const SCAN_LIMIT = 5000;
const DEFAULT_LIST_NAME = "Calling leads";

/**
 * Call leads for the Calling section. Phone numbers live in the
 * lead's fields JSON under "phone" (no separate phone column), so
 * this reads the workspace's leads with a bounded scan, the same
 * pattern as the Leads home search, and returns the ones with a
 * phone first. Each lead carries its latest call outcome so the
 * list can show "last call" without a second request.
 */
export async function GET(request: Request) {
  const session = await requireSession("VIEWER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const listId = new URL(request.url).searchParams.get("listId") ?? "";
  try {
    const [lists, leads] = await Promise.all([
      prisma.leadList.findMany({
        where: { workspaceId: ctx.workspace.id },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      prisma.lead.findMany({
        where: { workspaceId: ctx.workspace.id, ...(listId ? { listId } : {}) },
        orderBy: { createdAt: "desc" },
        take: SCAN_LIMIT,
        select: { id: true, email: true, listId: true, fields: true, status: true, createdAt: true },
      }),
    ]);
    const leadIds = leads.map((lead) => lead.id);
    const recentLogs = leadIds.length
      ? await prisma.callLog.findMany({
          where: { workspaceId: ctx.workspace.id, leadId: { in: leadIds } },
          orderBy: { calledAt: "desc" },
          select: { leadId: true, disposition: true, calledAt: true },
        })
      : [];
    const lastCallByLead = new Map<string, { disposition: string; calledAt: Date }>();
    for (const log of recentLogs) {
      if (log.leadId && !lastCallByLead.has(log.leadId)) {
        lastCallByLead.set(log.leadId, { disposition: log.disposition, calledAt: log.calledAt });
      }
    }
    const shaped = leads.map((lead) => {
      const fields =
        lead.fields && typeof lead.fields === "object" && !Array.isArray(lead.fields)
          ? (lead.fields as Record<string, unknown>)
          : {};
      // Case-insensitive: imports made before v1.44.0 could land the
      // number under a capitalised "Phone" key.
      const phoneKey = Object.keys(fields).find((key) => key.toLowerCase() === "phone");
      const phone =
        phoneKey && typeof fields[phoneKey] === "string" ? (fields[phoneKey] as string) : "";
      return {
        id: lead.id,
        email: lead.email,
        listId: lead.listId,
        fields,
        phone,
        lastCall: lastCallByLead.get(lead.id) ?? null,
      };
    });
    // Leads with a phone are callable; they come first, keeping the
    // newest-first order inside each group.
    const withPhone = shaped.filter((lead) => lead.phone);
    const withoutPhone = shaped.filter((lead) => !lead.phone);
    return NextResponse.json({ lists, leads: [...withPhone, ...withoutPhone] });
  } catch (error) {
    return apiError(error);
  }
}

/**
 * Manually add a call lead. Creates a normal Lead (so the same
 * person can later join an email list) with fields.phone set. Email
 * is optional for calling: when it is missing, the lead gets a
 * clearly synthetic address on the reserved .invalid TLD, which can
 * never receive mail, purely to satisfy the lead model's required
 * unique email. When an email is given, creation goes through the
 * shared createLead rules, including the in-workspace duplicate
 * refusal.
 */
export async function POST(request: Request) {
  const session = await requireSession("MEMBER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const body = await readJson<{
    name?: unknown;
    company?: unknown;
    phone?: unknown;
    website?: unknown;
    email?: unknown;
    listId?: unknown;
    newListName?: unknown;
  }>(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const phone = stringField(body.phone);
  if (!phone) {
    return NextResponse.json({ error: "A phone number is required" }, { status: 400 });
  }
  const name = stringField(body.name);
  const company = stringField(body.company);
  const website = stringField(body.website);
  const email = stringField(body.email);
  if (!name && !company) {
    return NextResponse.json({ error: "A name or a company is required" }, { status: 400 });
  }
  const [firstName, ...rest] = name.split(/\s+/).filter(Boolean);
  const fields: Record<string, string | number> = { phone };
  if (firstName) fields.firstName = firstName;
  if (rest.length) fields.lastName = rest.join(" ");
  if (company) fields.company = company;
  if (website) fields.website = website;
  // Enriched calling fields (v1.44.0): location, timezone and best
  // window, decision maker, pain points, hook, score and the per
  // lead personal script. Empty strings are dropped on create.
  const calling = callingFieldsFromBody(body as Record<string, unknown>);
  if ("error" in calling) {
    return NextResponse.json({ error: calling.error }, { status: 400 });
  }
  for (const [key, value] of Object.entries(calling.fields)) {
    if (value !== "") fields[key] = value;
  }

  try {
    let listId = stringField(body.listId) || null;
    const newListName = stringField(body.newListName);
    if (listId) {
      const list = await prisma.leadList.findFirst({
        where: { id: listId, workspaceId: ctx.workspace.id },
        select: { id: true },
      });
      if (!list) return NextResponse.json({ error: "List not found" }, { status: 404 });
    } else {
      const list = await prisma.leadList.create({
        data: { workspaceId: ctx.workspace.id, name: newListName || DEFAULT_LIST_NAME },
        select: { id: true },
      });
      listId = list.id;
    }

    let lead;
    if (email) {
      lead = await createLead(prisma, ctx.workspace.id, {
        email,
        listId,
        fields,
        firstName: fields.firstName,
        lastName: fields.lastName,
        company,
      });
    } else {
      const digits = phone.replace(/\D/g, "").slice(-10) || "unknown";
      const suffix = Math.random().toString(36).slice(2, 8);
      lead = await prisma.lead.create({
        data: {
          workspaceId: ctx.workspace.id,
          listId,
          email: `call-${digits}-${suffix}@calling.invalid`,
          fields,
          tags: [],
          status: "NEW",
        },
      });
    }
    await writeAuditLog({
      action: "call_lead.create",
      userId: ctx.user.id,
      workspaceId: ctx.workspace.id,
      metadata: { leadId: lead.id, listId },
    });
    return NextResponse.json(
      { lead: { id: lead.id, email: lead.email, listId: lead.listId, fields: lead.fields } },
      { status: 201 },
    );
  } catch (error) {
    return apiError(error);
  }
}
