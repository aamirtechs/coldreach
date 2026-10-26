import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, intField, requireSession } from "@/lib/api";

/** Paginated delivery log for one endpoint (session API, ADMIN). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession("ADMIN");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const { id } = await params;
  const url = new URL(request.url);
  const page = Math.max(1, intField(url.searchParams.get("page"), 1));
  const pageSize = Math.min(100, Math.max(1, intField(url.searchParams.get("pageSize"), 25)));
  try {
    const endpoint = await prisma.webhookEndpoint.findFirst({
      where: { id, workspaceId: ctx.workspace.id },
      select: { id: true },
    });
    if (!endpoint) return NextResponse.json({ error: "Webhook endpoint not found" }, { status: 404 });
    const [total, deliveries] = await Promise.all([
      prisma.webhookDelivery.count({ where: { endpointId: endpoint.id } }),
      prisma.webhookDelivery.findMany({
        where: { endpointId: endpoint.id },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return NextResponse.json({
      deliveries: deliveries.map((delivery) => ({
        id: delivery.id,
        eventType: delivery.eventType,
        status: delivery.status,
        attempts: delivery.attempts,
        nextAttemptAt: delivery.nextAttemptAt,
        lastStatusCode: delivery.lastStatusCode,
        lastError: delivery.lastError,
        payload: delivery.payload,
        createdAt: delivery.createdAt,
      })),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    });
  } catch (error) {
    return apiError(error);
  }
}
