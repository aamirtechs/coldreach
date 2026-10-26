import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, intField, readJson, requireSession, stringField } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";

interface VariantInput {
  subject?: unknown;
  bodyText?: unknown;
  bodyHtml?: unknown;
  weight?: unknown;
}

interface StepInput {
  subject?: unknown;
  body?: unknown;
  delayDays?: unknown;
  delayHours?: unknown;
  variants?: unknown;
}

const MAX_VARIANTS_PER_STEP = 2;
const VARIANT_LABELS = ["B", "C"];

/**
 * Replaces the campaign's whole sequence atomically, including each
 * step's A/B variants (the step itself is variant A; at most two
 * extra variants per step, labelled B and C by position). The builder
 * edits an ordered list client-side and saves it in one call, which
 * keeps the unique (campaignId, order) constraint trivially satisfied.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession("MEMBER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const { id } = await params;
  const body = await readJson<{ steps?: unknown }>(request);
  if (!body || !Array.isArray(body.steps)) {
    return NextResponse.json({ error: "A steps array is required" }, { status: 400 });
  }
  if (body.steps.length > 20) {
    return NextResponse.json({ error: "A sequence may have at most 20 steps" }, { status: 400 });
  }
  const steps: {
    order: number;
    subject: string;
    body: string;
    delayDays: number;
    delayHours: number;
    variants: { label: string; subject: string | null; bodyText: string; bodyHtml: string | null; weight: number }[];
  }[] = [];
  for (const [index, rawStep] of (body.steps as StepInput[]).entries()) {
    const rawVariants = Array.isArray(rawStep.variants) ? (rawStep.variants as VariantInput[]) : [];
    if (rawVariants.length > MAX_VARIANTS_PER_STEP) {
      return NextResponse.json(
        { error: `Step ${index + 1} has ${rawVariants.length} variants; at most ${MAX_VARIANTS_PER_STEP} extra variants (B and C) are allowed per step` },
        { status: 400 },
      );
    }
    const variants = [];
    for (const [variantIndex, rawVariant] of rawVariants.entries()) {
      const bodyText = typeof rawVariant.bodyText === "string" ? rawVariant.bodyText : "";
      if (!bodyText.trim()) {
        return NextResponse.json(
          { error: `Step ${index + 1} variant ${VARIANT_LABELS[variantIndex]} has an empty body. Give it content or remove the variant.` },
          { status: 400 },
        );
      }
      variants.push({
        label: VARIANT_LABELS[variantIndex],
        subject: stringField(rawVariant.subject) || null,
        bodyText,
        bodyHtml: typeof rawVariant.bodyHtml === "string" && rawVariant.bodyHtml.trim() ? rawVariant.bodyHtml : null,
        weight: Math.max(1, intField(rawVariant.weight, 1)),
      });
    }
    steps.push({
      order: index,
      subject: stringField(rawStep.subject),
      body: typeof rawStep.body === "string" ? rawStep.body : "",
      delayDays: Math.max(0, intField(rawStep.delayDays, 0)),
      delayHours: Math.max(0, intField(rawStep.delayHours, 0)),
      variants,
    });
  }
  try {
    const campaign = await prisma.campaign.findFirst({
      where: { id, workspaceId: ctx.workspace.id },
      select: { id: true, status: true },
    });
    if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    if (campaign.status === "RUNNING") {
      return NextResponse.json(
        { error: "Pause the campaign before editing its sequence" },
        { status: 409 },
      );
    }
    if (campaign.status === "ARCHIVED") {
      return NextResponse.json({ error: "Archived campaigns cannot be edited" }, { status: 409 });
    }
    const saved = await prisma.$transaction(async (tx) => {
      // Deleting the steps cascades to their variants.
      await tx.sequenceStep.deleteMany({ where: { campaignId: campaign.id } });
      for (const step of steps) {
        const created = await tx.sequenceStep.create({
          data: {
            campaignId: campaign.id,
            order: step.order,
            subject: step.subject,
            body: step.body,
            delayDays: step.delayDays,
            delayHours: step.delayHours,
          },
        });
        if (step.variants.length > 0) {
          await tx.stepVariant.createMany({
            data: step.variants.map((variant) => ({ ...variant, stepId: created.id })),
          });
        }
      }
      return tx.sequenceStep.findMany({
        where: { campaignId: campaign.id },
        orderBy: { order: "asc" },
        include: { variants: { orderBy: { createdAt: "asc" } } },
      });
    });
    await writeAuditLog({
      action: "campaign.steps_update",
      userId: ctx.user.id,
      workspaceId: ctx.workspace.id,
      metadata: { campaignId: campaign.id, stepCount: saved.length },
    });
    return NextResponse.json({ steps: saved });
  } catch (error) {
    return apiError(error);
  }
}
