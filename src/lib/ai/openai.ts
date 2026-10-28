import {
  AI_CONTENT_RULES,
  type AiProvider,
  type IcebreakerContext,
  type RewriteInstruction,
  type SubjectContext,
} from "./provider";

/**
 * OpenAI chat completions provider, called over plain fetch (no SDK).
 *
 * Credential gated like the mailbox providers: until OPENAI_API_KEY
 * exists in the environment, getAiProvider() returns null, the API
 * routes answer 501 naming the variable, and the UI panels show "AI
 * is not configured" instead of controls that cannot work.
 */

export const AI_MODEL_DEFAULT = "gpt-4o-mini";
const CHAT_URL = "https://api.openai.com/v1/chat/completions";

/**
 * Groq runs the same chat completions shape at an OpenAI-compatible
 * endpoint, so it reuses this provider class with a different URL and
 * model default. It is the fallback when OPENAI_API_KEY is absent:
 * set GROQ_API_KEY (and optionally GROQ_MODEL) instead.
 */
export const GROQ_MODEL_DEFAULT = "llama-3.3-70b-versatile";
const GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions";

type FetchImpl = typeof fetch;

export function aiMissingEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  return env.OPENAI_API_KEY || env.GROQ_API_KEY ? [] : ["OPENAI_API_KEY or GROQ_API_KEY"];
}

export function aiConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return aiMissingEnv(env).length === 0;
}

interface ChatMessage {
  role: "system" | "user";
  content: string;
}

export class OpenAiProvider implements AiProvider {
  readonly id: string;
  private readonly label: string;
  private readonly chatUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchImpl: FetchImpl;

  constructor(options: {
    apiKey: string;
    model?: string;
    fetchImpl?: FetchImpl;
    id?: string;
    label?: string;
    chatUrl?: string;
  }) {
    this.id = options.id ?? "openai";
    this.label = options.label ?? "OpenAI";
    this.chatUrl = options.chatUrl ?? CHAT_URL;
    this.apiKey = options.apiKey;
    this.model = options.model ?? AI_MODEL_DEFAULT;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async chat(messages: ChatMessage[]): Promise<string> {
    const response = await this.fetchImpl(this.chatUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: this.model, messages, temperature: 0.7 }),
    });
    const data = (await response.json().catch(() => null)) as {
      choices?: { message?: { content?: string } }[];
      error?: { message?: string };
    } | null;
    if (!response.ok) {
      throw Object.assign(
        new Error(`${this.label} request failed: ${data?.error?.message ?? response.statusText}`),
        { status: 502 },
      );
    }
    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      throw Object.assign(new Error(`${this.label} returned an empty response`), { status: 502 });
    }
    return content.trim();
  }

  async suggestSubjects(context: SubjectContext): Promise<string[]> {
    const count = Math.min(Math.max(context.count ?? 5, 1), 10);
    const content = await this.chat([
      { role: "system", content: AI_CONTENT_RULES },
      {
        role: "user",
        content: [
          `Suggest ${count} subject lines for a cold outreach email.`,
          context.campaignName ? `Campaign: ${context.campaignName}` : "",
          context.currentSubject ? `Current subject: ${context.currentSubject}` : "",
          context.body ? `Email body:\n${context.body}` : "",
          "Subjects must describe the email honestly, stay under 60 characters, and may use the personalization tokens already present in the body (for example {{firstName}}).",
          'Answer with a JSON array of strings only, for example ["Subject one", "Subject two"]. No other text.',
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ]);
    try {
      const parsed = JSON.parse(content) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.map(String).map((s) => s.trim()).filter(Boolean).slice(0, count);
      }
    } catch {
      // Fall through to line splitting below.
    }
    return content
      .split("\n")
      .map((line) => line.replace(/^[-*\d.\s"]+/, "").replace(/"$/, "").trim())
      .filter(Boolean)
      .slice(0, count);
  }

  async rewriteBody(body: string, instruction: RewriteInstruction): Promise<string> {
    return this.chat([
      { role: "system", content: AI_CONTENT_RULES },
      {
        role: "user",
        content: [
          `Rewrite the cold outreach email below to be ${instruction}.`,
          "Preserve every personalization token (for example {{firstName}}) exactly as written, keep the call to action, and do not add claims that are not in the original.",
          "Return only the rewritten email body, no commentary.",
          "",
          body,
        ].join("\n"),
      },
    ]);
  }

  async icebreaker(context: IcebreakerContext): Promise<string> {
    const fieldLines = Object.entries(context.leadFields)
      .filter(([key]) => key !== "icebreaker")
      .map(([key, value]) => `${key}: ${value}`)
      .join("\n");
    return this.chat([
      { role: "system", content: AI_CONTENT_RULES },
      {
        role: "user",
        content: [
          "Write ONE opening line (an icebreaker) for a cold email to this lead, using only the facts below. If the facts support nothing specific, write a polite generic opener that makes no factual claim.",
          `Lead email: ${context.leadEmail}`,
          fieldLines,
          context.campaignName ? `Campaign: ${context.campaignName}` : "",
          context.campaignContext ? `Campaign context: ${context.campaignContext}` : "",
          "Return only the single line, no quotes, no commentary.",
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ]);
  }
}

export type AiProviderId = "openai" | "groq";

/** Default model for a provider when no override is supplied. */
export function defaultAiModel(providerId: AiProviderId): string {
  return providerId === "groq" ? GROQ_MODEL_DEFAULT : AI_MODEL_DEFAULT;
}

/**
 * Build a provider from an explicit key (v1.8.0). Used for
 * per-workspace keys resolved by workspaceAi.ts, so a workspace key
 * constructs the identical client the environment path builds below.
 */
export function buildAiProvider(
  providerId: AiProviderId,
  apiKey: string,
  model?: string | null,
): AiProvider {
  if (providerId === "groq") {
    return new OpenAiProvider({
      apiKey,
      model: model || GROQ_MODEL_DEFAULT,
      id: "groq",
      label: "Groq",
      chatUrl: GROQ_CHAT_URL,
    });
  }
  return new OpenAiProvider({ apiKey, model: model || AI_MODEL_DEFAULT });
}

/**
 * The configured provider, or null when no AI key exists. OpenAI wins
 * when both keys are set; Groq is the fallback (OPENAI_API_KEY keeps
 * the AI_MODEL override, Groq reads GROQ_MODEL).
 */
export function getAiProvider(env: NodeJS.ProcessEnv = process.env): AiProvider | null {
  if (env.OPENAI_API_KEY) {
    return new OpenAiProvider({
      apiKey: env.OPENAI_API_KEY,
      model: env.AI_MODEL || AI_MODEL_DEFAULT,
    });
  }
  if (env.GROQ_API_KEY) {
    return new OpenAiProvider({
      apiKey: env.GROQ_API_KEY,
      model: env.GROQ_MODEL || GROQ_MODEL_DEFAULT,
      id: "groq",
      label: "Groq",
      chatUrl: GROQ_CHAT_URL,
    });
  }
  return null;
}

/** The model the configured provider will use, for status surfaces. */
export function activeAiModel(env: NodeJS.ProcessEnv = process.env): string {
  if (env.OPENAI_API_KEY) {
    return env.AI_MODEL || AI_MODEL_DEFAULT;
  }
  if (env.GROQ_API_KEY) {
    return env.GROQ_MODEL || GROQ_MODEL_DEFAULT;
  }
  return env.AI_MODEL || AI_MODEL_DEFAULT;
}

/** The configured provider's id ("openai" or "groq"), or null. */
export function activeAiProviderId(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.OPENAI_API_KEY) return "openai";
  if (env.GROQ_API_KEY) return "groq";
  return null;
}
