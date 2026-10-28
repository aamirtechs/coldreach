import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, readJson, requireSession, stringField } from "@/lib/api";
import { resolveWorkspaceAi } from "@/lib/ai/workspaceAi";
import { REWRITE_INSTRUCTIONS, type RewriteInstruction } from "@/lib/ai/provider";

function notConfigured() {
  return NextResponse.json(
    {
      error:
        "AI is not configured for this workspace. Add your OpenAI or Groq key in Integrations to enable it.",
      missingEnv: ["workspace AI key"],
    },
    { status: 501 },
  );
}

/**
 * AI rewrite of a step body with a preset instruction (shorter, more
 * direct, friendlier). Returns the draft only; nothing is saved or
 * applied server-side.
 */
export async function POST(request: Request) {
  const session = await requireSession("MEMBER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const resolved = await resolveWorkspaceAi(prisma, ctx.workspace.id);
  const provider = resolved?.provider ?? null;
  if (!provider) return notConfigured();
  const body = await readJson<{ body?: unknown; instruction?: unknown }>(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const text = typeof body.body === "string" ? body.body : "";
  if (!text.trim()) {
    return NextResponse.json({ error: "There is no body text to rewrite yet" }, { status: 400 });
  }
  const instruction = stringField(body.instruction) as RewriteInstruction;
  if (!REWRITE_INSTRUCTIONS.includes(instruction)) {
    return NextResponse.json(
      { error: `instruction must be one of: ${REWRITE_INSTRUCTIONS.join(", ")}` },
      { status: 400 },
    );
  }
  try {
    const rewritten = await provider.rewriteBody(text, instruction);
    return NextResponse.json({ body: rewritten, aiGenerated: true });
  } catch (error) {
    return apiError(error);
  }
}
