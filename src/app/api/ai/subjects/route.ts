import { NextResponse } from "next/server";
import { apiError, intField, readJson, requireSession, stringField } from "@/lib/api";
import { aiMissingEnv, getAiProvider } from "@/lib/ai/openai";

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
 * AI subject line suggestions for a sequence step. Output is a
 * draft: the builder inserts a suggestion only when the user clicks
 * Apply. See src/lib/ai/provider.ts for the content rules the
 * prompts enforce.
 */
export async function POST(request: Request) {
  const session = await requireSession("MEMBER");
  if ("error" in session) return session.error;
  const provider = getAiProvider();
  if (!provider) return notConfigured();
  const body = await readJson<{
    campaignName?: unknown;
    currentSubject?: unknown;
    body?: unknown;
    count?: unknown;
  }>(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  try {
    const subjects = await provider.suggestSubjects({
      campaignName: stringField(body.campaignName) || undefined,
      currentSubject: stringField(body.currentSubject) || undefined,
      body: typeof body.body === "string" ? body.body : undefined,
      count: intField(body.count, 5),
    });
    return NextResponse.json({ subjects, aiGenerated: true });
  } catch (error) {
    return apiError(error);
  }
}
