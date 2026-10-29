import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, requireSession, stringField } from "@/lib/api";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function parsePageParam(raw: string | null, fallback: number): number {
  if (raw === null || raw === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

/** Reads one trimmed string out of a lead's custom fields JSON. */
function leadField(fields: unknown, key: string): string | null {
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) return null;
  const value = stringField((fields as Record<string, unknown>)[key]);
  return value === "" ? null : value;
}

/**
 * Paginated enrollment list for the campaign detail page. The
 * campaign is loaded through the session workspace first, so another
 * tenant's campaign reads as not found. Lead name and company live in
 * the lead's fields JSON (the same place templates read them from);
 * they are surfaced as first-class values here alongside the raw
 * fields so the UI can show the segment without re-parsing JSON.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession("MEMBER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const { id } = await params;
  const url = new URL(request.url);
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, parsePageParam(url.searchParams.get("limit"), DEFAULT_LIMIT)),
  );
  const offset = parsePageParam(url.searchParams.get("offset"), 0);
  try {
    const campaign = await prisma.campaign.findFirst({
      where: { id, workspaceId: ctx.workspace.id },
      select: { id: true },
    });
    if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    const [total, rows] = await Promise.all([
      prisma.enrollment.count({ where: { campaignId: id } }),
      prisma.enrollment.findMany({
        where: { campaignId: id },
        orderBy: { enrolledAt: "asc" },
        skip: offset,
        take: limit,
        include: {
          lead: { select: { id: true, email: true, fields: true } },
        },
      }),
    ]);
    return NextResponse.json({
      total,
      enrollments: rows.map((row) => ({
        id: row.id,
        status: row.status,
        currentStep: row.currentStep,
        enrolledAt: row.enrolledAt,
        lead: {
          id: row.lead.id,
          email: row.lead.email,
          firstName: leadField(row.lead.fields, "firstName"),
          lastName: leadField(row.lead.fields, "lastName"),
          company: leadField(row.lead.fields, "company"),
          fields:
            row.lead.fields &&
            typeof row.lead.fields === "object" &&
            !Array.isArray(row.lead.fields)
              ? row.lead.fields
              : {},
        },
      })),
    });
  } catch (error) {
    return apiError(error);
  }
}
