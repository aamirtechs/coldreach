import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, requireSession } from "@/lib/api";
import { sendTestDelivery } from "@/lib/webhooks/service";

/**
 * Sends a test delivery through the same code path as real events,
 * so the outcome in the delivery log is exactly what production
 * deliveries experience.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession("ADMIN");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const { id } = await params;
  try {
    const endpoint = await prisma.webhookEndpoint.findFirst({
      where: { id, workspaceId: ctx.workspace.id },
    });
    if (!endpoint) return NextResponse.json({ error: "Webhook endpoint not found" }, { status: 404 });
    const delivery = await sendTestDelivery(prisma, endpoint);
    return NextResponse.json({
      delivery: {
        id: delivery.id,
        status: delivery.status,
        attempts: delivery.attempts,
        lastStatusCode: delivery.lastStatusCode,
        lastError: delivery.lastError,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
