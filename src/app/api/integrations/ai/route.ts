import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, readJson, requireSession, stringField } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";
import {
  deleteWorkspaceAiKey,
  getWorkspaceAiConfigSummary,
  getWorkspaceAiStatus,
  saveWorkspaceAiKey,
} from "@/lib/ai/workspaceAi";
import type { AiProviderId } from "@/lib/ai/openai";

/**
 * The workspace's own AI provider key (v1.8.0).
 *
 * GET reports status only: which source serves the workspace (its
 * own key, the platform owner's key, or none), the provider, and the
 * model. The key itself is write-only: PUT stores it encrypted, and
 * no response ever contains the key or any part of it. PUT and
 * DELETE require ADMIN, matching the Integrations page.
 */

export async function GET() {
  const session = await requireSession("VIEWER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  try {
    const [status, own] = await Promise.all([
      getWorkspaceAiStatus(prisma, ctx.workspace.id),
      getWorkspaceAiConfigSummary(prisma, ctx.workspace.id),
    ]);
    return NextResponse.json({
      configured: status.configured,
      source: status.source,
      provider: status.providerId,
      model: status.model,
      hasOwnKey: own !== null,
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(request: Request) {
  const session = await requireSession("ADMIN");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const body = await readJson<{ provider?: unknown; apiKey?: unknown; model?: unknown }>(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

  const providerRaw = stringField(body.provider);
  const providerId: AiProviderId | null =
    providerRaw === "openai" || providerRaw === "groq" ? providerRaw : null;
  if (!providerId) {
    return NextResponse.json({ error: "provider must be openai or groq" }, { status: 400 });
  }
  const apiKey = stringField(body.apiKey);
  if (!apiKey) {
    return NextResponse.json({ error: "apiKey is required" }, { status: 400 });
  }
  const model = stringField(body.model);

  try {
    await saveWorkspaceAiKey(prisma, ctx.workspace.id, {
      providerId,
      apiKey,
      model: model || null,
    });
    await writeAuditLog({
      action: "ai.key.save",
      userId: ctx.user.id,
      workspaceId: ctx.workspace.id,
      metadata: { provider: providerId },
    });
    const status = await getWorkspaceAiStatus(prisma, ctx.workspace.id);
    return NextResponse.json({
      configured: status.configured,
      source: status.source,
      provider: status.providerId,
      model: status.model,
      hasOwnKey: true,
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE() {
  const session = await requireSession("ADMIN");
  if ("error" in session) return session.error;
  const { ctx } = session;
  try {
    const removed = await deleteWorkspaceAiKey(prisma, ctx.workspace.id);
    if (removed) {
      await writeAuditLog({
        action: "ai.key.delete",
        userId: ctx.user.id,
        workspaceId: ctx.workspace.id,
        metadata: {},
      });
    }
    const status = await getWorkspaceAiStatus(prisma, ctx.workspace.id);
    return NextResponse.json({
      configured: status.configured,
      source: status.source,
      provider: status.providerId,
      model: status.model,
      hasOwnKey: false,
    });
  } catch (error) {
    return apiError(error);
  }
}
