import { NextResponse } from "next/server";
import { apiError, readJson, requireSession, stringField } from "@/lib/api";
import { aiMissingEnv, getAiProvider } from "@/lib/ai/openai";
import { REWRITE_INSTRUCTIONS, type RewriteInstruction } from "@/lib/ai/provider";

function notConfigured() {
  return NextResponse.json(
    {
      error: "AI assistance is not configured on this server. Set OPENAI_API_KEY in the environment to enable it.",
      missingEnv: aiMissingEnv(),
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
  const provider = getAiProvider();
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
