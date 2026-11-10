import { describe, expect, it, vi } from "vitest";
import { isProductMailConfigured, productMailFrom, sendProductEmail } from "./productMail";

const ENV = { RESEND_API_KEY: "re_test_key" } as unknown as NodeJS.ProcessEnv;

describe("product mail configuration", () => {
  it("is configured only when RESEND_API_KEY is set", () => {
    expect(isProductMailConfigured(ENV)).toBe(true);
    expect(isProductMailConfigured({} as unknown as NodeJS.ProcessEnv)).toBe(false);
  });

  it("uses PRODUCT_MAIL_FROM when set and a branded default otherwise", () => {
    expect(productMailFrom(ENV)).toBe("ColdReach <no-reply@aamirtechs.com>");
    expect(
      productMailFrom({ PRODUCT_MAIL_FROM: "ColdReach <no-reply@send.example.com>" } as unknown as NodeJS.ProcessEnv),
    ).toBe("ColdReach <no-reply@send.example.com>");
  });
});

describe("sendProductEmail", () => {
  it("posts to Resend with the key, from, and recipient", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: "msg-1" }), { status: 200 }));
    const result = await sendProductEmail(
      { to: "new@example.com", subject: "Verify", text: "Click the link" },
      { env: ENV, fetchImpl },
    );
    expect(result).toEqual({ sent: true, id: "msg-1" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer re_test_key");
    const body = JSON.parse(init.body as string) as { from: string; to: string[]; subject: string };
    expect(body.from).toBe("ColdReach <no-reply@aamirtechs.com>");
    expect(body.to).toEqual(["new@example.com"]);
    expect(body.subject).toBe("Verify");
  });

  it("passes replyTo through as reply_to when provided", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: "msg-2" }), { status: 200 }));
    const result = await sendProductEmail(
      { to: "support@example.com", subject: "Ticket", text: "Body", replyTo: "user@example.com" },
      { env: ENV, fetchImpl },
    );
    expect(result.sent).toBe(true);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { reply_to?: string };
    expect(body.reply_to).toBe("user@example.com");
  });

  it("reports provider failures without throwing", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 500 }));
    await expect(
      sendProductEmail({ to: "a@example.com", subject: "S", text: "T" }, { env: ENV, fetchImpl }),
    ).resolves.toEqual({ sent: false, reason: "provider_500" });
  });

  it("reports an unreachable provider without throwing", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("offline");
    });
    await expect(
      sendProductEmail({ to: "a@example.com", subject: "S", text: "T" }, { env: ENV, fetchImpl }),
    ).resolves.toEqual({ sent: false, reason: "provider_unreachable" });
  });

  it("does not call the provider when unconfigured", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    await expect(
      sendProductEmail(
        { to: "a@example.com", subject: "S", text: "T" },
        { env: {} as unknown as NodeJS.ProcessEnv, fetchImpl },
      ),
    ).resolves.toEqual({ sent: false, reason: "not_configured" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
