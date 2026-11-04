import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, requireSession } from "@/lib/api";
import { renderEmailCopy } from "@/lib/campaigns/previewEmail";
import { resolveLeadCountry, resolveLeadTimezone } from "@/lib/domain/leadTimezone";
import type { LeadFields } from "@/lib/domain/personalize";
import { createUnsubscribeToken } from "@/lib/worker/unsubscribe";

/**
 * Exact email preview for one enrollment (v1.16.0).
 *
 * Powers the dashboard Upcoming sends "Preview email" button. The
 * copy is rendered by renderEmailCopy, the same function the sending
 * worker uses, with the enrollment's real next step, A/B variant,
 * spintax seed, lead fields, campaign signature and identity, and
 * the lead's real unsubscribe link, so what is shown here is what
 * will be sent unless the sequence or lead is edited first.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession("VIEWER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const { id } = await params;
  try {
    const enrollment = await prisma.enrollment.findFirst({
      where: { id, campaign: { workspaceId: ctx.workspace.id } },
      include: {
        lead: true,
        campaign: {
          include: {
            steps: {
              orderBy: { order: "asc" },
              include: { variants: { orderBy: { createdAt: "asc" } } },
            },
            workspace: true,
          },
        },
      },
    });
    if (!enrollment) {
      return NextResponse.json({ error: "Enrollment not found" }, { status: 404 });
    }
    const stepIndex = enrollment.currentStep;
    const step = enrollment.campaign.steps[stepIndex];
    if (!step) {
      return NextResponse.json(
        { error: "This enrollment has no next step to preview. The sequence is complete." },
        { status: 409 },
      );
    }
    const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
    let unsubscribeUrl = `${appUrl}/u/preview`;
    try {
      unsubscribeUrl = `${appUrl}/u/${createUnsubscribeToken(ctx.workspace.id, enrollment.lead.id, enrollment.campaign.id)}`;
    } catch {
      // SESSION_SECRET unavailable in this environment: the preview
      // still shows the exact copy, with a placeholder link noted.
    }
    const leadFields: LeadFields =
      enrollment.lead.fields && typeof enrollment.lead.fields === "object" && !Array.isArray(enrollment.lead.fields)
        ? (enrollment.lead.fields as LeadFields)
        : {};
    const copy = renderEmailCopy({
      enrollmentId: enrollment.id,
      stepIndex,
      step,
      leadEmail: enrollment.lead.email,
      leadFields,
      campaign: enrollment.campaign,
      workspace: enrollment.campaign.workspace,
      unsubscribeUrl,
    });
    const country = resolveLeadCountry(leadFields);
    return NextResponse.json({
      preview: {
        enrollmentId: enrollment.id,
        to: enrollment.lead.email,
        company: typeof leadFields.company === "string" ? leadFields.company : null,
        campaignId: enrollment.campaign.id,
        campaignName: enrollment.campaign.name,
        campaignStatus: enrollment.campaign.status,
        stepNumber: stepIndex + 1,
        variantLabel: copy.variantLabel,
        subject: copy.subject,
        bodyText: copy.bodyText,
        fullText: copy.fullText,
        scheduledAt: enrollment.nextSendAt?.toISOString() ?? null,
        timezone: resolveLeadTimezone(leadFields) ?? enrollment.campaign.timezone,
        country: country ? { code: country.code, name: country.name, flag: country.flag, state: country.state } : null,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
