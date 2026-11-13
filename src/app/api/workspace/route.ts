import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, readJson, requireSession, stringField } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";

export async function GET() {
  const session = await requireSession("VIEWER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  return NextResponse.json({
    workspace: {
      id: ctx.workspace.id,
      name: ctx.workspace.name,
      senderName: ctx.workspace.senderName,
      senderAddress: ctx.workspace.senderAddress,
      trackingDomain: ctx.workspace.trackingDomain,
      hourlySendCap: ctx.workspace.hourlySendCap,
    },
    role: ctx.role,
  });
}

export async function PATCH(request: Request) {
  const session = await requireSession("ADMIN");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const body = await readJson<{ name?: unknown; senderName?: unknown; senderAddress?: unknown; trackingDomain?: unknown; hourlySendCap?: unknown }>(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const data: Record<string, unknown> = {};
  if (body.name !== undefined) {
    const name = stringField(body.name);
    if (!name) return NextResponse.json({ error: "Workspace name cannot be empty" }, { status: 400 });
    data.name = name;
  }
  if (body.senderName !== undefined) data.senderName = stringField(body.senderName) || null;
  if (body.senderAddress !== undefined) data.senderAddress = stringField(body.senderAddress) || null;
  if (body.trackingDomain !== undefined) {
    // Bare host only (v1.11.0): no scheme, no path, no port. The
    // tracking URLs are built as https://<host>/..., so anything
    // richer would produce broken links.
    const raw = stringField(body.trackingDomain).trim().toLowerCase();
    if (!raw) {
      data.trackingDomain = null;
    } else if (/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(raw)) {
      data.trackingDomain = raw;
    } else {
      return NextResponse.json(
        {
          error:
            "Tracking domain must be a bare host like track.example.com, with no https:// prefix and no path.",
        },
        { status: 400 },
      );
    }
  }
  if (body.hourlySendCap !== undefined) {
    // Per-workspace hourly send cap (v1.24.0): null clears back to
    // the platform default; otherwise a whole number in a sane
    // range. The worker measures the workspace's per-domain hourly
    // count against this ceiling, so it should sit just under the
    // mail host's own hourly limit.
    if (body.hourlySendCap === null) {
      data.hourlySendCap = null;
    } else if (
      typeof body.hourlySendCap === "number" &&
      Number.isInteger(body.hourlySendCap) &&
      body.hourlySendCap >= 1 &&
      body.hourlySendCap <= 10000
    ) {
      data.hourlySendCap = body.hourlySendCap;
    } else {
      return NextResponse.json(
        {
          error:
            "Max sends per hour must be a whole number between 1 and 10000, or left empty to use the platform default.",
        },
        { status: 400 },
      );
    }
  }
  try {
    const workspace = await prisma.workspace.update({ where: { id: ctx.workspace.id }, data });
    await writeAuditLog({
      action: "workspace.update",
      userId: ctx.user.id,
      workspaceId: ctx.workspace.id,
      metadata: { fields: Object.keys(data) },
    });
    return NextResponse.json({ workspace });
  } catch (error) {
    return apiError(error);
  }
}
