import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, readJson, requireSession, stringField } from "@/lib/api";
import { hasEncryptionKey } from "@/lib/security/crypto";
import {
  WEBHOOK_EVENT_TYPES,
  createWebhookEndpoint,
  endpointEventTypes,
} from "@/lib/webhooks/service";
import { writeAuditLog } from "@/lib/audit";

/**
 * Outbound webhook endpoints (session API, ADMIN and above). The
 * signing secret is returned exactly once at creation; it is stored
 * only as ciphertext and can never be read back.
 */
export async function GET() {
  const session = await requireSession("ADMIN");
  if ("error" in session) return session.error;
  const { ctx } = session;
  try {
    const endpoints = await prisma.webhookEndpoint.findMany({
      where: { workspaceId: ctx.workspace.id },
      orderBy: { createdAt: "desc" },
      include: {
        deliveries: { orderBy: { createdAt: "desc" }, take: 10 },
        _count: { select: { deliveries: true } },
      },
    });
    return NextResponse.json({
      endpoints: endpoints.map((endpoint) => ({
        id: endpoint.id,
        url: endpoint.url,
        eventTypes: endpointEventTypes(endpoint),
        active: endpoint.active,
        createdAt: endpoint.createdAt,
        deliveryCount: endpoint._count.deliveries,
        recentDeliveries: endpoint.deliveries.map((delivery) => ({
          id: delivery.id,
          eventType: delivery.eventType,
          status: delivery.status,
          attempts: delivery.attempts,
          lastStatusCode: delivery.lastStatusCode,
          lastError: delivery.lastError,
          createdAt: delivery.createdAt,
        })),
      })),
      availableEventTypes: WEBHOOK_EVENT_TYPES,
      encryptionReady: hasEncryptionKey(),
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  const session = await requireSession("ADMIN");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const body = await readJson<{ url?: unknown; eventTypes?: unknown }>(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const url = stringField(body.url);
  if (!url) return NextResponse.json({ error: "An endpoint URL is required" }, { status: 400 });
  if (!Array.isArray(body.eventTypes)) {
    return NextResponse.json(
      { error: `eventTypes must be an array chosen from: ${WEBHOOK_EVENT_TYPES.join(", ")}` },
      { status: 400 },
    );
  }
  if (!hasEncryptionKey()) {
    return NextResponse.json(
      {
        error:
          "Webhook secrets are stored encrypted, which needs ENCRYPTION_KEY in the server environment. Set it and redeploy, then create the endpoint.",
        missingEnv: ["ENCRYPTION_KEY"],
      },
      { status: 501 },
    );
  }
  try {
    const { endpoint, secret } = await createWebhookEndpoint(prisma, {
      workspaceId: ctx.workspace.id,
      url,
      eventTypes: body.eventTypes.map(String),
    });
    await writeAuditLog({
      action: "webhook.create",
      userId: ctx.user.id,
      workspaceId: ctx.workspace.id,
      metadata: { endpointId: endpoint.id, url: endpoint.url, eventTypes: endpointEventTypes(endpoint) },
    });
    return NextResponse.json(
      {
        endpoint: {
          id: endpoint.id,
          url: endpoint.url,
          eventTypes: endpointEventTypes(endpoint),
          active: endpoint.active,
          createdAt: endpoint.createdAt,
        },
        // Shown exactly once. Receivers use it to verify the
        // X-ColdReach-Signature header on every delivery.
        secret,
      },
      { status: 201 },
    );
  } catch (error) {
    return apiError(error);
  }
}
