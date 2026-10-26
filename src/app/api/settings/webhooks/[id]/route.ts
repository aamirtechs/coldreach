import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, readJson, requireSession } from "@/lib/api";
import { WEBHOOK_EVENT_TYPES, isWebhookEventType, validateEndpointUrl } from "@/lib/webhooks/service";
import { writeAuditLog } from "@/lib/audit";

/** Pauses/resumes an endpoint or edits its URL and subscriptions. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession("ADMIN");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const { id } = await params;
  const body = await readJson<{ active?: unknown; url?: unknown; eventTypes?: unknown }>(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  try {
    const endpoint = await prisma.webhookEndpoint.findFirst({
      where: { id, workspaceId: ctx.workspace.id },
      select: { id: true },
    });
    if (!endpoint) return NextResponse.json({ error: "Webhook endpoint not found" }, { status: 404 });
    const data: Record<string, unknown> = {};
    if (body.active !== undefined) data.active = Boolean(body.active);
    if (body.url !== undefined) data.url = validateEndpointUrl(String(body.url));
    if (body.eventTypes !== undefined) {
      if (!Array.isArray(body.eventTypes) || body.eventTypes.length === 0) {
        return NextResponse.json(
          { error: `eventTypes must be a non-empty array chosen from: ${WEBHOOK_EVENT_TYPES.join(", ")}` },
          { status: 400 },
        );
      }
      const types = [...new Set(body.eventTypes.map(String))];
      if (!types.every(isWebhookEventType)) {
        return NextResponse.json(
          { error: `eventTypes must be chosen from: ${WEBHOOK_EVENT_TYPES.join(", ")}` },
          { status: 400 },
        );
      }
      data.eventTypes = types;
    }
    const updated = await prisma.webhookEndpoint.update({ where: { id: endpoint.id }, data });
    await writeAuditLog({
      action: "webhook.update",
      userId: ctx.user.id,
      workspaceId: ctx.workspace.id,
      metadata: { endpointId: endpoint.id, fields: Object.keys(data) },
    });
    return NextResponse.json({ endpoint: updated });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession("ADMIN");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const { id } = await params;
  try {
    const endpoint = await prisma.webhookEndpoint.findFirst({
      where: { id, workspaceId: ctx.workspace.id },
      select: { id: true, url: true },
    });
    if (!endpoint) return NextResponse.json({ error: "Webhook endpoint not found" }, { status: 404 });
    await prisma.webhookEndpoint.delete({ where: { id: endpoint.id } });
    await writeAuditLog({
      action: "webhook.delete",
      userId: ctx.user.id,
      workspaceId: ctx.workspace.id,
      metadata: { endpointId: endpoint.id, url: endpoint.url },
    });
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return apiError(error);
  }
}
