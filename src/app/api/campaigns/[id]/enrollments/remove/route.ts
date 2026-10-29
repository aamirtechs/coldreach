import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, readJson, requireSession } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";

interface RemoveBody {
  enrollmentIds?: unknown;
}

const MAX_ENROLLMENT_IDS = 200;

/**
 * Removes enrollments from one campaign. The lead itself is never
 * touched; it stays in its list and can be enrolled again later.
 *
 * Safety guard: an enrollment that has been contacted (its sequence
 * has started, currentStep >= 1, or a SENT event exists for it) is
 * never removed, and one contacted id in the batch refuses the whole
 * removal with 409. Deleting send history attribution to clean up a
 * list is exactly the silent data loss this endpoint exists to avoid;
 * ids that simply do not belong to this campaign are reported as
 * notFound instead of failing the batch.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession("MEMBER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const { id } = await params;
  const body = await readJson<RemoveBody>(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const enrollmentIds = Array.isArray(body.enrollmentIds)
    ? [...new Set(body.enrollmentIds.map(String))].slice(0, MAX_ENROLLMENT_IDS)
    : [];
  if (enrollmentIds.length === 0) {
    return NextResponse.json({ error: "enrollmentIds is required" }, { status: 400 });
  }
  try {
    const campaign = await prisma.campaign.findFirst({
      where: { id, workspaceId: ctx.workspace.id },
      select: { id: true },
    });
    if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

    const found = await prisma.enrollment.findMany({
      where: { campaignId: id, id: { in: enrollmentIds } },
      select: { id: true, currentStep: true, lead: { select: { email: true } } },
    });
    const notFound = enrollmentIds.length - found.length;
    if (found.length === 0) {
      return NextResponse.json({ removed: 0, notFound });
    }

    const sentEvents = await prisma.emailEvent.findMany({
      where: { enrollmentId: { in: found.map((row) => row.id) }, type: "SENT" },
      select: { enrollmentId: true },
    });
    const sentEnrollmentIds = new Set(sentEvents.map((event) => event.enrollmentId));
    const contacted = found.filter(
      (row) => row.currentStep >= 1 || sentEnrollmentIds.has(row.id),
    );
    if (contacted.length > 0) {
      const emails = contacted.map((row) => row.lead.email);
      return NextResponse.json(
        {
          error:
            `Cannot remove ${emails.length === 1 ? "a lead that has" : "leads that have"} ` +
            `already been contacted: ${emails.join(", ")}. ` +
            "Contacted leads stay in the campaign so their sending history is kept.",
          contacted: emails,
        },
        { status: 409 },
      );
    }

    const result = await prisma.enrollment.deleteMany({
      where: { campaignId: id, id: { in: found.map((row) => row.id) } },
    });
    await writeAuditLog({
      action: "campaign.enrollments_removed",
      userId: ctx.user.id,
      workspaceId: ctx.workspace.id,
      metadata: {
        campaignId: id,
        count: result.count,
        emails: found.map((row) => row.lead.email),
      },
    });
    return NextResponse.json({ removed: result.count, notFound });
  } catch (error) {
    return apiError(error);
  }
}
