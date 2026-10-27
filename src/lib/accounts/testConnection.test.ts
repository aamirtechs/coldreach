import { describe, expect, it } from "vitest";
import type { MailboxCredentials } from "@/lib/providers/smtp";
import {
  friendlyMailboxConnectionError,
  testMailboxConnection,
  type MailboxConnectionVerifier,
} from "./testConnection";

const CREDS: MailboxCredentials = {
  smtp: { host: "mail.example.com", port: 465, secure: true },
  imap: { host: "mail.example.com", port: 993, secure: true },
  user: "owner@example.com",
  pass: "fake-password",
};

describe("testMailboxConnection with a fake verifier", () => {
  it("reports both protocols ok when both verify", async () => {
    const verifier: MailboxConnectionVerifier = {
      verifySmtp: async () => undefined,
      verifyImap: async () => undefined,
    };
    await expect(testMailboxConnection(CREDS, verifier)).resolves.toEqual({
      smtp: { ok: true },
      imap: { ok: true },
    });
  });

  it("reports each protocol independently when one side fails", async () => {
    const verifier: MailboxConnectionVerifier = {
      verifySmtp: async () => undefined,
      verifyImap: async () => {
        throw new Error("Invalid credentials given");
      },
    };
    const results = await testMailboxConnection(CREDS, verifier);
    expect(results.smtp).toEqual({ ok: true });
    expect(results.imap.ok).toBe(false);
    expect(results.imap.error).toMatch(/Authentication failed/);
  });

  it("reports IMAP as not configured when the mailbox has no IMAP side", async () => {
    const verifier: MailboxConnectionVerifier = {
      verifySmtp: async () => undefined,
      verifyImap: async () => undefined,
    };
    const results = await testMailboxConnection({ ...CREDS, imap: null }, verifier);
    expect(results.smtp).toEqual({ ok: true });
    expect(results.imap).toEqual({
      ok: false,
      error: "IMAP is not configured for this mailbox.",
    });
  });
});

describe("friendlyMailboxConnectionError", () => {
  it("maps the common failure classes and never echoes raw detail", () => {
    expect(friendlyMailboxConnectionError(new Error("EAUTH invalid credentials"))).toMatch(
      /Authentication failed/,
    );
    expect(
      friendlyMailboxConnectionError(
        Object.assign(new Error("getaddrinfo ENOTFOUND mail.example.com"), { code: "ENOTFOUND" }),
      ),
    ).toMatch(/Host unreachable/);
    expect(friendlyMailboxConnectionError(new Error("connect ETIMEDOUT 203.0.113.5:993"))).toMatch(
      /timed out/,
    );
    expect(
      friendlyMailboxConnectionError(new Error("self-signed certificate in certificate chain")),
    ).toMatch(/certificate/);
    expect(friendlyMailboxConnectionError(new Error("connect ECONNREFUSED"))).toMatch(
      /Port closed/,
    );
    expect(friendlyMailboxConnectionError(new Error("something unexpected"))).toMatch(
      /Connection failed/,
    );
  });
});
