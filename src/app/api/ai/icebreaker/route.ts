import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, readJson, requireSession, stringField } from "@/lib/api";
import { aiMissingEnv, getAiProvider } from "@/lib/ai/openai";
import { writeAuditLog } from "@/lib/audit";

function notConfigured() {
  return NextResponse.json(
    {
      error: "AI assistance is not configured on this server. Set OPENAI_API_KEY in the environment to enable it.",
      missingEnv: aiMissingEnv(),
    },
    { status: 501 },
  );
}

/**
 * Generates a one-line icebreaker for a lead from its stored fields
 * and saves it back onto the lead as the "icebreaker" custom field,
 * which makes it a personalization token ({{icebreaker}}) in every
 * sequence. The line is AI generated; the UI marks it as such and the
 * user can regenerate or ignore it.
 */
export async function POST(request: Request) {
  const session = await requireSession("MEMBER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const provider = getAiProvider();
  if (!provider) return notConfigured();
  const body = await readJson<{ leadId?: unknown; campaignId?: unknown }>(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const leadId = stringField(body.leadId);
  if (!leadId) return NextResponse.json({ error: "leadId is required" }, { status: 400 });
  try {
    const lead = await prisma.lead.findFirst({
      where: { id: leadId, workspaceId: ctx.workspace.id },
    });
    if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    let campaignName: string | undefined;
    const campaignId = stringField(body.campaignId);
    if (campaignId) {
      const campaign = await prisma.campaign.findFirst({
        where: { id: campaignId, workspaceId: ctx.workspace.id },
        select: { name: true },
      });
      if (campaign) campaignName = campaign.name;
    }
    const fields: Record<string, string> =
      lead.fields && typeof lead.fields === "object" && !Array.isArray(lead.fields)
        ? Object.fromEntries(
            Object.entries(lead.fields as Record<string, unknown>).map(([k, v]) => [k, String(v)]),
          )
        : {};
    const icebreaker = await provider.icebreaker({
      leadFields: fields,
      leadEmail: lead.email,
      campaignName,
    });
    const updated = await prisma.lead.update({
      where: { id: lead.id },
      data: { fields: { ...fields, icebreaker } },
    });
    await writeAuditLog({
      action: "ai.icebreaker",
      userId: ctx.user.id,
      workspaceId: ctx.workspace.id,
      metadata: { leadId: lead.id },
    });
    return NextResponse.json({ icebreaker, lead: updated, aiGenerated: true });
  } catch (error) {
    return apiError(error);
  }
}
