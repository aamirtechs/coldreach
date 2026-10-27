import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api";
import { activeAiModel, activeAiProviderId, aiConfigured, aiMissingEnv } from "@/lib/ai/openai";

/**
 * Reports whether AI assistance can actually run on this server.
 * The campaign builder and leads UI render "AI is not configured"
 * with the missing variable names from this payload instead of
 * offering controls that would fail. OpenAI is used when its key is
 * set; Groq is the fallback when only GROQ_API_KEY exists.
 */
export async function GET() {
  const session = await requireSession("VIEWER");
  if ("error" in session) return session.error;
  return NextResponse.json({
    configured: aiConfigured(),
    missingEnv: aiMissingEnv(),
    provider: activeAiProviderId(),
    model: activeAiModel(),
  });
}
