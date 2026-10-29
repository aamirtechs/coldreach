import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Manual compose route. Session, Prisma, provider, and audit
 * collaborators are mocked in the same style as the accounts route
 * test; the provider is a simulation double that records its send
 * calls, so the suppression and connection gates can be proven to run
 * before any send happens.
 */

const mocks = vi.hoisted(() => {
  const state = {
    account: null as Record<string, unknown> | null,
    suppressions: [] as Array<Record<string, unknown>>,
    lead: null as { id: string; email: string } | null,
    sendCalls: [] as Array<Record<string, unknown>>,
    threads: [] as Array<Record<string, unknown>>,
    messages: [] as Array<Record<string, unknown>>,
    events: [] as Array<Record<string, unknown>>,
  };
  const provider = {
    isSimulation: true,
    send: vi.fn(async (input: Record<string, unknown>) => {
      state.sendCalls.push(input);
      return { providerMessageId: "sim-msg-1" };
    }),
  };
  const prisma = {
    sendingAccount: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; workspaceId: string } }) =>
        state.account &&
        state.account.id === where.id &&
        state.account.workspaceId === where.workspaceId
          ? state.account
          : null,
      ),
    },
    suppression: {
      findMany: vi.fn(async () => state.suppressions),
    },
    lead: {
      findFirst: vi.fn(async ({ where }: { where: { workspaceId: string; email: string } }) =>
        state.lead && state.lead.email === where.email ? { id: state.lead.id } : null,
      ),
    },
    thread: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const thread = { id: "thread-1", ...data };
        state.threads.push(thread);
        return thread;
      }),
    },
    threadMessage: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const message = { id: "msg-1", ...data };
        state.messages.push(message);
        return message;
      }),
    },
    emailEvent: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.events.push(data);
        return { id: "evt-1", ...data };
      }),
    },
  };
  return {
    state,
    provider,
    prisma,
    writeAuditLog: vi.fn(async () => undefined),
    requireSession: vi.fn(async () => ({
      ctx: {
        user: { id: "user-1" },
        workspace: { id: "ws-1", senderName: "Workspace Sender" },
        role: "OWNER",
      },
    })),
  };
});

vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));

vi.mock("@/lib/api", () => ({
  requireSession: mocks.requireSession,
  apiError: (error: unknown) =>
    new Response(JSON.stringify({ error: error instanceof Error ? error.message : "error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    }),
  readJson: async (request: Request) => {
    try {
      return await request.json();
    } catch {
      return null;
    }
  },
  stringField: (value: unknown) => (typeof value === "string" ? value.trim() : ""),
}));

vi.mock("@/lib/audit", () => ({ writeAuditLog: mocks.writeAuditLog }));

vi.mock("@/lib/providers", () => ({
  resolveProvider: async () => mocks.provider,
}));

import { POST } from "./route";

const CONNECTED_ACCOUNT = {
  id: "acct-1",
  workspaceId: "ws-1",
  email: "sender@example.com",
  displayName: "Sender Name",
  provider: "SIMULATION",
  status: "CONNECTED",
};

function postRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/threads/compose", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sendingAccountId: "acct-1",
    to: "fresh@example.com",
    subject: "Hello there",
    body: "First line\nSecond line",
    ...overrides,
  };
}

beforeAll(() => {
  process.env.SESSION_SECRET = "compose-test-secret-value";
});

beforeEach(() => {
  mocks.state.account = { ...CONNECTED_ACCOUNT };
  mocks.state.suppressions = [];
  mocks.state.lead = null;
  mocks.state.sendCalls = [];
  mocks.state.threads = [];
  mocks.state.messages = [];
  mocks.state.events = [];
  mocks.provider.send.mockClear();
});

describe("POST /api/threads/compose", () => {
  it("rejects missing fields before any send", async () => {
    const response = await POST(postRequest({}));
    expect(response.status).toBe(400);
    expect(mocks.provider.send).not.toHaveBeenCalled();

    const badRecipient = await POST(postRequest(validBody({ to: "not-an-email" })));
    expect(badRecipient.status).toBe(400);
    expect(mocks.provider.send).not.toHaveBeenCalled();
    expect(mocks.state.threads).toHaveLength(0);
  });

  it("blocks a suppressed recipient before any provider send", async () => {
    mocks.state.suppressions = [
      { scope: "WORKSPACE", email: "blocked@example.com", domain: null, reason: "UNSUBSCRIBED" },
    ];
    const response = await POST(postRequest(validBody({ to: "Blocked@Example.com" })));
    expect(response.status).toBe(400);
    const payload = (await response.json()) as { error: string };
    expect(payload.error).toMatch(/suppression list/);
    expect(mocks.provider.send).not.toHaveBeenCalled();
    expect(mocks.state.threads).toHaveLength(0);
    expect(mocks.state.events).toHaveLength(0);
  });

  it("blocks a disconnected account with a clear error", async () => {
    mocks.state.account = { ...CONNECTED_ACCOUNT, status: "DISCONNECTED" };
    const response = await POST(postRequest(validBody()));
    expect(response.status).toBe(400);
    const payload = (await response.json()) as { error: string };
    expect(payload.error).toMatch(/not connected/);
    expect(mocks.provider.send).not.toHaveBeenCalled();
    expect(mocks.state.threads).toHaveLength(0);
  });

  it("returns 404 when the account is outside the workspace", async () => {
    mocks.state.account = { ...CONNECTED_ACCOUNT, workspaceId: "ws-2" };
    const response = await POST(postRequest(validBody()));
    expect(response.status).toBe(404);
    expect(mocks.provider.send).not.toHaveBeenCalled();
  });

  it("a SIMULATION send creates the thread, outbound message, and SENT event", async () => {
    const response = await POST(postRequest(validBody()));
    expect(response.status).toBe(201);
    const payload = (await response.json()) as {
      thread: { id: string; campaignId: string | null; leadId: string | null; unread: boolean };
      message: { id: string };
      demo: boolean;
    };
    expect(payload.demo).toBe(true);
    expect(payload.thread.campaignId).toBeNull();
    expect(payload.thread.leadId).toBeNull();
    expect(payload.thread.unread).toBe(false);

    expect(mocks.provider.send).toHaveBeenCalledTimes(1);
    const sendInput = mocks.state.sendCalls[0];
    expect(sendInput.toEmail).toBe("fresh@example.com");
    expect(sendInput.fromEmail).toBe("sender@example.com");
    expect(sendInput.fromName).toBe("Sender Name");
    expect(sendInput.html).toContain("First line<br/>Second line");

    expect(mocks.state.messages).toHaveLength(1);
    expect(mocks.state.messages[0].direction).toBe("OUTBOUND");
    expect(String(mocks.state.messages[0].body)).toContain("[DEMO: simulated send");

    expect(mocks.state.events).toHaveLength(1);
    expect(mocks.state.events[0].type).toBe("SENT");
    expect(mocks.state.events[0].idempotencyKey).toBe("compose:sim-msg-1");
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "thread.compose_send" }),
    );
  });

  it("links the thread to an existing lead and adds unsubscribe headers", async () => {
    mocks.state.lead = { id: "lead-1", email: "fresh@example.com" };
    const response = await POST(postRequest(validBody()));
    expect(response.status).toBe(201);
    const payload = (await response.json()) as { thread: { leadId: string | null } };
    expect(payload.thread.leadId).toBe("lead-1");
    const headers = mocks.state.sendCalls[0].headers as Record<string, string>;
    expect(headers["List-Unsubscribe"]).toMatch(/\/u\//);
    expect(headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });
});
