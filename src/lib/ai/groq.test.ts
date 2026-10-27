import { describe, expect, it } from "vitest";
import { OpenAiProvider, activeAiModel, activeAiProviderId, aiConfigured, getAiProvider } from "./openai";

describe("Groq fallback selection", () => {
  it("uses Groq when only GROQ_API_KEY is set", () => {
    const env = { GROQ_API_KEY: "gsk-test" } as unknown as NodeJS.ProcessEnv;
    expect(aiConfigured(env)).toBe(true);
    expect(getAiProvider(env)?.id).toBe("groq");
    expect(activeAiProviderId(env)).toBe("groq");
    expect(activeAiModel(env)).toBe("llama-3.3-70b-versatile");
  });

  it("prefers OpenAI when both keys are set", () => {
    const env = { OPENAI_API_KEY: "sk-test", GROQ_API_KEY: "gsk-test" } as unknown as NodeJS.ProcessEnv;
    expect(getAiProvider(env)?.id).toBe("openai");
    expect(activeAiProviderId(env)).toBe("openai");
    expect(activeAiModel(env)).toBe("gpt-4o-mini");
  });

  it("honours the GROQ_MODEL override", () => {
    const env = { GROQ_API_KEY: "gsk-test", GROQ_MODEL: "llama-3.1-8b-instant" } as unknown as NodeJS.ProcessEnv;
    expect(activeAiModel(env)).toBe("llama-3.1-8b-instant");
  });

  it("sends Groq requests to the Groq chat completions endpoint", async () => {
    const captured: { url: string; headers: Record<string, string>; body: { model: string } }[] = [];
    const fetchImpl = (async (url: string, init?: { headers?: Record<string, string>; body?: string }) => {
      captured.push({
        url,
        headers: init?.headers ?? {},
        body: JSON.parse(init?.body ?? "{}") as { model: string },
      });
      return new Response(JSON.stringify({ choices: [{ message: { content: "Line." } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;
    const provider = new OpenAiProvider({
      apiKey: "gsk-test-key",
      model: "llama-3.3-70b-versatile",
      id: "groq",
      label: "Groq",
      chatUrl: "https://api.groq.com/openai/v1/chat/completions",
      fetchImpl,
    });
    const line = await provider.icebreaker({ leadFields: { company: "Acme" }, leadEmail: "a@acme.example" });
    expect(line).toBe("Line.");
    expect(captured[0].url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(captured[0].headers.Authorization).toBe("Bearer gsk-test-key");
    expect(captured[0].body.model).toBe("llama-3.3-70b-versatile");
  });
});
