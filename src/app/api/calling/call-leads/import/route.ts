import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { apiError, readJson, requireSession, stringField } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";
import { parseCsv } from "@/lib/csv";
import { guessImportTarget } from "@/lib/leads/import";
import { callLeadFromBody } from "@/lib/calling/callLeadFields";
import { getCallingService } from "@/lib/calling/services";

const MAX_ROWS = 1000;

/**
 * CSV import for call leads (v1.47.0). Uses the same column
 * guessing as the email import wizard (phone, city, state,
 * timezone, decisionMaker, namePronunciation, painPoints,
 * mobileScore, lcp, personalScript and friends land under their
 * canonical keys), but every row becomes a CallLead in the
 * dedicated calling system. The email Lead model is never touched.
 * Rows without a phone, or without a name and a company, are
 * skipped and reported, never silently dropped.
 */
export async function POST(request: Request) {
  const session = await requireSession("MEMBER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const body = await readJson<{
    csv?: unknown;
    listId?: unknown;
    newListName?: unknown;
    serviceSlug?: unknown;
  }>(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const csv = stringField(body.csv);
  if (!csv.trim()) return NextResponse.json({ error: "CSV text is required" }, { status: 400 });
  const defaultService = stringField(body.serviceSlug) || "wordpress-speed";
  if (!getCallingService(defaultService)) {
    return NextResponse.json({ error: `Unknown service: ${defaultService}` }, { status: 400 });
  }
  try {
    let listId = stringField(body.listId) || null;
    if (listId) {
      const list = await prisma.callLeadList.findFirst({
        where: { id: listId, workspaceId: ctx.workspace.id },
        select: { id: true },
      });
      if (!list) return NextResponse.json({ error: "List not found" }, { status: 404 });
    } else {
      const list = await prisma.callLeadList.create({
        data: {
          workspaceId: ctx.workspace.id,
          name: stringField(body.newListName) || "Imported call leads",
          serviceSlug: defaultService,
        },
        select: { id: true },
      });
      listId = list.id;
    }

    const parsed = parseCsv(csv);
    const skipped: { row: number; reason: string }[] = [];
    let created = 0;
    const rows = parsed.rows.slice(0, MAX_ROWS);
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const record: Record<string, unknown> = {};
      for (const [header, raw] of Object.entries(row)) {
        const value = (raw ?? "").trim();
        if (value) record[guessImportTarget(header)] = value;
      }
      record.listId = listId;
      if (!record.serviceSlug) record.serviceSlug = defaultService;
      const result = callLeadFromBody(record);
      if ("error" in result) {
        skipped.push({ row: index + 2, reason: result.error });
        continue;
      }
      const { lead } = result;
      await prisma.callLead.create({
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
      created += 1;
    }
    await writeAuditLog({
      action: "call_lead.import",
      userId: ctx.user.id,
      workspaceId: ctx.workspace.id,
      metadata: { listId, created, skipped: skipped.length },
    });
    return NextResponse.json({ created, skipped, listId }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
