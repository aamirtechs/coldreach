import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, requireSession } from "@/lib/api";
import { toCsv } from "@/lib/csv";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession("VIEWER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const { id } = await params;
  try {
    const list = await prisma.leadList.findFirst({
      where: { id, workspaceId: ctx.workspace.id },
      select: { id: true, name: true },
    });
    if (!list) return NextResponse.json({ error: "List not found" }, { status: 404 });

    const leads = await prisma.lead.findMany({
      where: { workspaceId: ctx.workspace.id, listId: list.id },
      orderBy: { createdAt: "asc" },
    });

    const fieldKeys = new Set<string>();
    for (const lead of leads) {
      if (lead.fields && typeof lead.fields === "object" && !Array.isArray(lead.fields)) {
        for (const key of Object.keys(lead.fields)) {
          fieldKeys.add(key);
        }
      }
    }
    const headers = ["email", "status", "tags", ...[...fieldKeys].sort()];
    const rows = leads.map((lead) => {
      const fields =
        lead.fields && typeof lead.fields === "object" && !Array.isArray(lead.fields)
          ? (lead.fields as Record<string, unknown>)
          : {};
      const tags = Array.isArray(lead.tags) ? lead.tags.map(String).join(";") : "";
      const row: Record<string, string> = {
        email: lead.email,
        status: lead.status,
        tags,
      };
      for (const key of fieldKeys) {
        const value = fields[key];
        row[key] = value === null || value === undefined ? "" : String(value);
      }
      return row;
    });

    const csv = toCsv(headers, rows);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${list.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-leads.csv"`,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
