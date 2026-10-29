import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  createClickToken,
  recordClick,
  resolveTrackingBase,
  rewriteLinksForTracking,
  verifyClickToken,
} from "./clickTracking";
import { createOpenToken } from "./openTracking";

process.env.SESSION_SECRET = "click-tracking-test-secret";

const workspaceId = "workspace-1";
const campaignId = "campaign-1";
const enrollmentId = "enrollment-1";
const sendingAccountId = "account-1";
const TARGET_URL = "https://example.com/some.path/page.html?ref=a.b&utm_source=email#section.1";
const OTHER_URL = "https://example.com/another/page";

interface FakeEvent {
  id: string;
  workspaceId: string;
  campaignId: string | null;
  enrollmentId: string | null;
  sendingAccountId: string | null;
  type: string;
  idempotencyKey: string;
  variant: string | null;
  occurredAt: Date;
}

/**
 * In-memory stand-in for the slice of Prisma recordClick uses:
 * enrollment lookup with its campaign, idempotency lookup, latest
 * SENT lookup, and event creation. Events accumulate across the
 * recordClick tests below, mirroring the shared seeded database
 * the open tracking suite asserts against.
 */
function makeFakeDb() {
  const events: FakeEvent[] = [
    {
      id: "event-sent",
      workspaceId,
      campaignId,
      enrollmentId,
      sendingAccountId,
      type: "SENT",
      idempotencyKey: `sent:${enrollmentId}:0`,
      variant: "A",
      occurredAt: new Date(),
    },
  ];
  const enrollment = {
    id: enrollmentId,
    campaignId,
    campaign: { id: campaignId, workspaceId },
  };
  const db = {
    enrollment: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === enrollmentId ? enrollment : null,
    },
    emailEvent: {
      findUnique: async ({ where }: { where: { idempotencyKey: string } }) =>
        events.find((event) => event.idempotencyKey === where.idempotencyKey) ?? null,
      findFirst: async ({
        where,
      }: {
        where: { enrollmentId: string; type: string };
      }) =>
        [...events]
          .reverse()
          .find((event) => event.enrollmentId === where.enrollmentId && event.type === where.type) ??
        null,
      create: async ({ data }: { data: Omit<FakeEvent, "id"> }) => {
        const event: FakeEvent = { id: `event-${events.length}`, ...data };
        events.push(event);
        return event;
      },
    },
  };
  return { db: db as unknown as PrismaClient, events };
}

const { db, events } = makeFakeDb();

function clickedEvents(): FakeEvent[] {
  return events.filter((event) => event.type === "CLICKED");
}

describe("click tokens", () => {
  it("round-trips workspace, enrollment, step and target URL", () => {
    const token = createClickToken(workspaceId, enrollmentId, 0, TARGET_URL);
    expect(verifyClickToken(token)).toEqual({
      workspaceId,
      enrollmentId,
      stepIndex: 0,
      targetUrl: TARGET_URL,
    });
  });

  it("rejects a tampered signature", () => {
    const token = createClickToken(workspaceId, enrollmentId, 0, TARGET_URL);
    const [payload, signature] = token.split(".");
    const flipped = `${payload}.${signature.startsWith("A") ? "B" : "A"}${signature.slice(1)}`;
    expect(verifyClickToken(flipped)).toBeNull();
    expect(verifyClickToken("not-a-token")).toBeNull();
    expect(verifyClickToken("")).toBeNull();
  });

  it("rejects a tampered payload", () => {
    const token = createClickToken(workspaceId, enrollmentId, 0, TARGET_URL);
    const [, signature] = token.split(".");
    const otherPayload = createClickToken(workspaceId, enrollmentId, 1, OTHER_URL).split(".")[0];
    expect(verifyClickToken(`${otherPayload}.${signature}`)).toBeNull();

    const [payload] = token.split(".");
    const flippedPayload = `${payload.startsWith("A") ? "B" : "A"}${payload.slice(1)}`;
    expect(verifyClickToken(`${flippedPayload}.${signature}`)).toBeNull();
  });

  it("rejects a javascript target even with a valid signature", () => {
    const token = createClickToken(workspaceId, enrollmentId, 0, "javascript:alert(1)");
    expect(verifyClickToken(token)).toBeNull();
  });

  it("never accepts an open token as a click token", () => {
    const open = createOpenToken(workspaceId, enrollmentId, 0);
    expect(verifyClickToken(open)).toBeNull();
  });
});

describe("resolveTrackingBase", () => {
  it("uses https on the tracking domain when one is set", () => {
    expect(resolveTrackingBase({ trackingDomain: "track.example.com" }, "https://app.example.com")).toBe(
      "https://track.example.com",
    );
    expect(resolveTrackingBase({ trackingDomain: " track.example.com/ " }, "https://app.example.com")).toBe(
      "https://track.example.com",
    );
  });

  it("falls back to the app URL with its trailing slash removed", () => {
    expect(resolveTrackingBase({ trackingDomain: null }, "https://app.example.com/")).toBe(
      "https://app.example.com",
    );
    expect(resolveTrackingBase({ trackingDomain: "  " }, "https://app.example.com/")).toBe(
      "https://app.example.com",
    );
    expect(resolveTrackingBase({}, "https://app.example.com")).toBe("https://app.example.com");
  });
});

describe("recordClick", () => {
  it("records one CLICKED event with the send's attribution, then dedupes", async () => {
    const claims = { workspaceId, enrollmentId, stepIndex: 0, targetUrl: TARGET_URL };
    const first = await recordClick(db, claims);
    expect(first).toEqual({ recorded: true, duplicate: false });

    const urlHash = createHash("sha256").update(TARGET_URL).digest("hex").slice(0, 16);
    const event = clickedEvents()[0];
    expect(event?.workspaceId).toBe(workspaceId);
    expect(event?.campaignId).toBe(campaignId);
    expect(event?.enrollmentId).toBe(enrollmentId);
    expect(event?.sendingAccountId).toBe(sendingAccountId);
    expect(event?.variant).toBe("A");
    expect(event?.idempotencyKey).toBe(`evt:${enrollmentId}:0:CLICKED:${urlHash}`);

    const second = await recordClick(db, claims);
    expect(second).toEqual({ recorded: false, duplicate: true });
    expect(clickedEvents()).toHaveLength(1);
  });

  it("records a second event for a different target URL", async () => {
    const result = await recordClick(db, {
      workspaceId,
      enrollmentId,
      stepIndex: 0,
      targetUrl: OTHER_URL,
    });
    expect(result).toEqual({ recorded: true, duplicate: false });
    expect(clickedEvents()).toHaveLength(2);
  });

  it("records nothing for a workspace mismatch", async () => {
    const result = await recordClick(db, {
      workspaceId: "another-workspace",
      enrollmentId,
      stepIndex: 0,
      targetUrl: "https://example.com/never/recorded",
    });
    expect(result).toEqual({ recorded: false, duplicate: false });
    expect(clickedEvents()).toHaveLength(2);
  });
});

describe("rewriteLinksForTracking", () => {
  const args = {
    trackingBase: "https://track.example.com",
    workspaceId: "ws-1",
    enrollmentId: "enr-1",
    stepIndex: 0,
    unsubscribeUrl: "https://app.example.com/u/token123",
  };

  it("rewrites ordinary links and leaves the unsubscribe link untouched", () => {
    const html =
      '<p><a href="https://vendor.example/pricing">See pricing</a></p>' +
      '<p><a href="https://app.example.com/u/token123">Unsubscribe</a></p>';
    const out = rewriteLinksForTracking(html, args);
    expect(out).toContain("https://track.example.com/c/");
    expect(out).toContain('<a href="https://app.example.com/u/token123">Unsubscribe</a>');
    const claims = verifyClickToken(out.match(/\/c\/([A-Za-z0-9_\-.]+)/)?.[1] ?? "");
    expect(claims?.targetUrl).toBe("https://vendor.example/pricing");
  });

  it("skips mailto, anchors, and URLs already on the tracking host", () => {
    const html =
      '<a href="mailto:hi@example.com">mail</a>' +
      '<a href="#top">top</a>' +
      '<a href="https://track.example.com/o/abc">pixelish</a>' +
      '<img src="https://track.example.com/o/abc" width="1" height="1" />';
    const out = rewriteLinksForTracking(html, args);
    expect(out).toBe(html);
  });

  it("returns html without links unchanged", () => {
    expect(rewriteLinksForTracking("<p>Hello</p>", args)).toBe("<p>Hello</p>");
  });
});
