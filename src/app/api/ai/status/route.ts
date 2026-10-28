import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/api";
import { getWorkspaceAiStatus } from "@/lib/ai/workspaceAi";

/**
 * Reports whether AI assistance can run in THIS workspace (v1.8.0).
 * Each workspace uses its own OpenAI or Groq key from Integrations;
 * the platform owner's workspace may also use the deployment keys.
 * The campaign builder and leads UI render "AI is not configured"
 * from this payload instead of offering controls that would fail.
 */
export async function GET() {
  const session = await requireSession("VIEWER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const status = await getWorkspaceAiStatus(prisma, ctx.workspace.id);
  return NextResponse.json({
    configured: status.configured,
    missingEnv: status.configured ? [] : ["workspace AI key"],
    provider: status.providerId,
    model: status.model,
    source: status.source,
  });
}
