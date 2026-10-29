import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, requireSession } from "@/lib/api";
import { resolveWorkspaceAi } from "@/lib/ai/workspaceAi";
import {
  buildIcebreakerContext,
  cleanIcebreaker,
  existingIcebreaker,
  extractReadableText,
  websiteUrlForLead,
  type LeadFieldMap,
} from "@/lib/leads/icebreakerGen";
import { writeAuditLog } from "@/lib/audit";

/**
 * AI icebreaker generation for a lead list (v1.11.0).
 *
 * For each lead in the list whose fields carry no icebreaker yet,
 * the lead's own website is fetched (5 second timeout, best effort)
 * and reduced to a readable excerpt, then the workspace's configured
 * AI provider writes one opening line from the lead's fields plus
 * that excerpt. The cleaned line is stored in fields.icebreaker,
 * where sequence templates already render it through {{icebreaker}}.
 *
 * At most 25 leads are processed per call so a request stays short;
 * the response reports how many remain so the UI can offer another
 * run. A failure on one lead (fetch, provider, empty output) never
 * stops the batch. When the workspace has no AI configured the call
 * is a clear 400, not a silent no-op: generation is impossible and
 * the operator should be told to add a key.
 */

const MAX_PER_CALL = 25;
const FETCH_TIMEOUT_MS = 5000;

async function fetchWebsiteText(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ColdReach/1.11)" },
      redirect: "follow",
    });
    if (!response.ok) return "";
    const html = await response.text();
    return extractReadableText(html);
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession("MEMBER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const { id } = await params;
  try {
    const list = await prisma.leadList.findFirst({
      where: { id, workspaceId: ctx.workspace.id },
      select: { id: true },
    });
    if (!list) {
      return NextResponse.json({ error: "Lead list not found" }, { status: 404 });
    }

    const ai = await resolveWorkspaceAi(prisma, ctx.workspace.id);
    if (!ai) {
      return NextResponse.json(
        {
          error:
            "AI is not configured for this workspace. Add an OpenAI or Groq key on the Integrations page, then try again.",
        },
        { status: 400 },
      );
    }

    const leads = await prisma.lead.findMany({
      where: { workspaceId: ctx.workspace.id, listId: id },
      select: { id: true, email: true, fields: true },
      orderBy: { createdAt: "asc" },
    });
    const fieldsOf = (lead: (typeof leads)[number]): LeadFieldMap =>
      lead.fields && typeof lead.fields === "object" && !Array.isArray(lead.fields)
        ? (lead.fields as LeadFieldMap)
        : {};
    const missing = leads.filter((lead) => !existingIcebreaker(fieldsOf(lead)));
    const skipped = leads.length - missing.length;
    const batch = missing.slice(0, MAX_PER_CALL);

    let generated = 0;
    let failed = 0;
    for (const lead of batch) {
      try {
        const fields = fieldsOf(lead);
        const website = websiteUrlForLead(fields);
        const websiteText = website ? await fetchWebsiteText(website) : "";
        const context = buildIcebreakerContext({ email: lead.email, fields }, websiteText);
        const raw = await ai.provider.icebreaker(context);
        const cleaned = cleanIcebreaker(raw);
        if (!cleaned) {
          failed += 1;
          continue;
        }
        await prisma.lead.update({
          where: { id: lead.id },
          data: { fields: { ...fields, icebreaker: cleaned } },
        });
        generated += 1;
      } catch {
        failed += 1;
      }
    }

    const result = {
      generated,
      skipped,
      failed,
      // Failed leads still have no icebreaker, so they remain for a
      // later run alongside the ones this call never reached.
      remaining: missing.length - generated,
    };
    await writeAuditLog({
      action: "lead_list.generate_icebreakers",
      userId: ctx.user.id,
      workspaceId: ctx.workspace.id,
      metadata: { listId: id, ...result },
    });
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}
