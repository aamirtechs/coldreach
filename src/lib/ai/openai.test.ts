import { describe, expect, it } from "vitest";
import { OpenAiProvider, aiConfigured, aiMissingEnv, getAiProvider } from "./openai";

describe("AI configuration gating", () => {
  it("reports OPENAI_API_KEY as missing and yields no provider without it", () => {
    const env = {} as NodeJS.ProcessEnv;
    expect(aiMissingEnv(env)).toEqual(["OPENAI_API_KEY"]);
    expect(aiConfigured(env)).toBe(false);
    expect(getAiProvider(env)).toBeNull();
  });

  it("yields a provider when the key exists", () => {
    const env = { OPENAI_API_KEY: "sk-test" } as unknown as NodeJS.ProcessEnv;
    expect(aiMissingEnv(env)).toEqual([]);
    expect(aiConfigured(env)).toBe(true);
    expect(getAiProvider(env)?.id).toBe("openai");
  });
});

interface CapturedRequest {
  url: string;
  headers: Record<string, string>;
  body: { model: string; messages: { role: string; content: string }[] };
}

function mockFetch(responseContent: string, captured: CapturedRequest[]): typeof fetch {
  return (async (url: string, init?: { headers?: Record<string, string>; body?: string }) => {
    captured.push({
      url,
      headers: init?.headers ?? {},
      body: JSON.parse(init?.body ?? "{}") as CapturedRequest["body"],
    });
    return new Response(
      JSON.stringify({ choices: [{ message: { content: responseContent } }] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as unknown as typeof fetch;
}

describe("OpenAiProvider", () => {
  it("sends the chat request shape and parses subject suggestions", async () => {
    const captured: CapturedRequest[] = [];
    const provider = new OpenAiProvider({
      apiKey: "sk-test-key",
      model: "gpt-4o-mini",
      fetchImpl: mockFetch('["Quick question, {{firstName}}", "Your hiring plans"]', captured),
    });
    const subjects = await provider.suggestSubjects({ campaignName: "SDR outreach", body: "Body text", count: 2 });
    expect(subjects).toEqual(["Quick question, {{firstName}}", "Your hiring plans"]);
    expect(captured).toHaveLength(1);
    expect(captured[0].url).toBe("https://api.openai.com/v1/chat/completions");
    expect(captured[0].headers.Authorization).toBe("Bearer sk-test-key");
    expect(captured[0].body.model).toBe("gpt-4o-mini");
    // The content rules ride along as the system prompt.
    expect(captured[0].body.messages[0].role).toBe("system");
    expect(captured[0].body.messages[0].content).toContain("Never invent facts");
    expect(captured[0].body.messages[0].content).toContain("evade spam filters");
  });

  it("rewrites a body with the preset instruction", async () => {
    const captured: CapturedRequest[] = [];
    const provider = new OpenAiProvider({
      apiKey: "sk-test-key",
      fetchImpl: mockFetch("Short version.", captured),
    });
    const rewritten = await provider.rewriteBody("A much longer original body.", "shorter");
    expect(rewritten).toBe("Short version.");
    expect(captured[0].body.messages[1].content).toContain("shorter");
  });

  it("writes an icebreaker from lead fields", async () => {
    const captured: CapturedRequest[] = [];
    const provider = new OpenAiProvider({
      apiKey: "sk-test-key",
      fetchImpl: mockFetch("Saw Acme is hiring SDRs.", captured),
    });
    const line = await provider.icebreaker({
      leadFields: { firstName: "Jane", company: "Acme" },
      leadEmail: "jane@acme.example",
    });
    expect(line).toBe("Saw Acme is hiring SDRs.");
    expect(captured[0].body.messages[1].content).toContain("company: Acme");
  });

  it("surfaces provider errors instead of inventing output", async () => {
    const failing = (async () =>
      new Response(JSON.stringify({ error: { message: "quota exceeded" } }), { status: 429 })) as unknown as typeof fetch;
    const provider = new OpenAiProvider({ apiKey: "sk-test-key", fetchImpl: failing });
    await expect(provider.suggestSubjects({})).rejects.toThrow(/quota exceeded/);
  });
});
