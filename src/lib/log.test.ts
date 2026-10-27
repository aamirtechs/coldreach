import { describe, expect, it } from "vitest";
import { buildLogEntry, buildSentryEnvelope, formatLogLine, parseSentryDsn } from "./log";

describe("structured logger", () => {
  it("builds entries with timestamp, level, message, and context fields", () => {
    const entry = buildLogEntry("info", "Send tick complete", {
      requestId: "req-1",
      workspaceId: "ws-1",
      sent: 3,
    });
    expect(entry.level).toBe("info");
    expect(entry.msg).toBe("Send tick complete");
    expect(entry.requestId).toBe("req-1");
    expect(entry.workspaceId).toBe("ws-1");
    expect(entry.sent).toBe(3);
    expect(() => new Date(entry.ts).toISOString()).not.toThrow();
    const parsed = JSON.parse(formatLogLine(entry)) as Record<string, unknown>;
    expect(parsed.msg).toBe("Send tick complete");
  });

  it("serializes Error objects instead of dumping stacks into the line", () => {
    const entry = buildLogEntry("error", "Boom", { error: new Error("kaput") });
    expect(entry.error).toBe("Error: kaput");
    expect(formatLogLine(entry)).not.toContain("\n");
  });

  it("keeps non-Error error values readable", () => {
    expect(buildLogEntry("error", "x", { error: "plain" }).error).toBe("plain");
    expect(buildLogEntry("error", "x", { error: 42 }).error).toBe("42");
  });
});

describe("Sentry envelope support", () => {
  const dsn = "https://abc123publickey@o123.ingest.sentry.io/456789";

  it("parses a DSN into envelope URL and auth header", () => {
    const parsed = parseSentryDsn(dsn);
    expect(parsed?.projectId).toBe("456789");
    expect(parsed?.envelopeUrl).toBe("https://o123.ingest.sentry.io/api/456789/envelope/");
    expect(parsed?.authHeader).toContain("sentry_key=abc123publickey");
  });

  it("rejects malformed DSNs", () => {
    expect(parseSentryDsn("not-a-url")).toBeNull();
    expect(parseSentryDsn("https://host.example/")).toBeNull();
  });

  it("builds a three-line envelope carrying the error entry", () => {
    const entry = buildLogEntry("error", "Tick failed", {
      error: new Error("db down"),
      workspaceId: "ws-9",
    });
    const envelope = buildSentryEnvelope(dsn, entry);
    expect(envelope).not.toBeNull();
    const lines = (envelope as string).split("\n");
    expect(lines).toHaveLength(3);
    const header = JSON.parse(lines[0]) as { dsn: string; event_id: string };
    const item = JSON.parse(lines[1]) as { type: string };
    const payload = JSON.parse(lines[2]) as {
      message: string;
      level: string;
      extra: { error: string; workspaceId: string };
    };
    expect(header.dsn).toBe(dsn);
    expect(item.type).toBe("event");
    expect(payload.message).toBe("Tick failed");
    expect(payload.level).toBe("error");
    expect(payload.extra.error).toBe("Error: db down");
    expect(payload.extra.workspaceId).toBe("ws-9");
  });
});
