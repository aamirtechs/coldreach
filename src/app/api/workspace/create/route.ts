import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, readJson, requireSession, stringField } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "workspace";
}

/**
 * Creates an additional workspace for the signed-in user, who
 * becomes its OWNER. Powers the Agency Command Center's creation
 * action; switching to the new workspace goes through the existing
 * switch endpoint afterwards.
 */
export async function POST(request: Request) {
  const session = await requireSession("VIEWER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const body = await readJson<{ name?: unknown }>(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const name = stringField(body.name);
  if (!name) return NextResponse.json({ error: "A workspace name is required" }, { status: 400 });
  try {
    const slug = `${slugify(name)}-${Math.random().toString(36).slice(2, 8)}`;
    const workspace = await prisma.$transaction(async (tx) => {
      const created = await tx.workspace.create({ data: { name, slug } });
      await tx.membership.create({
        data: { userId: ctx.user.id, workspaceId: created.id, role: "OWNER" },
      });
      return created;
    });
    await writeAuditLog({
      action: "workspace.create",
      userId: ctx.user.id,
      workspaceId: workspace.id,
      metadata: { name: workspace.name },
    });
    return NextResponse.json(
      { workspace: { id: workspace.id, name: workspace.name }, role: "OWNER" },
      { status: 201 },
    );
  } catch (error) {
    return apiError(error);
  }
}
