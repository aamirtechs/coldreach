import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api";
import { AI_MODEL_DEFAULT, aiConfigured, aiMissingEnv } from "@/lib/ai/openai";

/**
 * Reports whether AI assistance can actually run on this server.
 * The campaign builder and leads UI render "AI is not configured"
 * with the missing variable names from this payload instead of
 * offering controls that would fail.
 */
export async function GET() {
  const session = await requireSession("VIEWER");
  if ("error" in session) return session.error;
  return NextResponse.json({
    configured: aiConfigured(),
    missingEnv: aiMissingEnv(),
    model: process.env.AI_MODEL || AI_MODEL_DEFAULT,
  });
}
