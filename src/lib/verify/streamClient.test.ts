import { afterEach, describe, expect, it, vi } from "vitest";
import { streamVerification } from "./streamClient";

function ndjsonResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "application/x-ndjson" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("streamVerification", () => {
  it("parses start, progress and done lines, even split across chunks", async () => {
    const lines = [
      JSON.stringify({ type: "start", total: 2 }),
      JSON.stringify({
        type: "progress",
        done: 1,
        total: 2,
        counts: { valid: 1, risky: 0, invalid: 0, unknown: 0 },
        last: { email: "a@acme.com", status: "VALID" },
      }),
      JSON.stringify({
        type: "done",
        totalRows: 2,
        uniqueEmails: 2,
        counts: { valid: 1, risky: 0, invalid: 1, unknown: 0 },
        verdicts: {
          "a@acme.com": { status: "VALID", detail: { provider: null, reasons: [], checkedAt: "t" } },
        },
      }),
    ];
    const payload = lines.map((l) => `${l}\n`).join("");
    // Split mid-line to prove chunk boundaries do not matter.
    const chunks = [payload.slice(0, 40), payload.slice(40, 90), payload.slice(90)];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ndjsonResponse(chunks)),
    );

    const started: number[] = [];
    const progressEvents: number[] = [];
    const result = await streamVerification({
      url: "/api/verify-emails",
      body: { emails: ["a@acme.com"] },
      onStart: (total) => started.push(total),
      onProgress: (p) => progressEvents.push(p.done),
    });
    expect(started).toEqual([2]);
    expect(progressEvents).toEqual([1]);
    expect(result.uniqueEmails).toBe(2);
    expect(result.counts.invalid).toBe(1);
    expect(result.verdicts["a@acme.com"].status).toBe("VALID");
  });

  it("throws the server's error line", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        ndjsonResponse([`${JSON.stringify({ type: "error", error: "sidecar exploded" })}\n`]),
      ),
    );
    await expect(
      streamVerification({ url: "/api/verify-emails", body: {} }),
    ).rejects.toThrow("sidecar exploded");
  });

  it("throws when the stream ends without a done line", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ndjsonResponse([`${JSON.stringify({ type: "start", total: 1 })}\n`])),
    );
    await expect(
      streamVerification({ url: "/api/verify-emails", body: {} }),
    ).rejects.toThrow("without a result");
  });
});
