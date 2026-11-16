import type { VerificationStatus } from "./builtin";
import type { VerificationDetail } from "./service";

/**
 * Client side reader for the streaming verification endpoints
 * (import wizard step 2 and the standalone Verify Emails tool).
 * The server answers NDJSON lines: {type:"start", total},
 * {type:"progress", done, total, counts, last}, then either
 * {type:"done", ...result} or {type:"error", error}. This helper
 * parses the stream (including lines split across chunks) and
 * resolves with the final result; it throws on an error line, a
 * non-OK response, or a stream that ends without a done line.
 */

export interface VerifyCounts {
  valid: number;
  risky: number;
  invalid: number;
  unknown: number;
}

export interface VerifyStreamProgress {
  done: number;
  total: number;
  counts: VerifyCounts;
  last: { email: string; status: VerificationStatus };
}

export interface VerifyStreamResult {
  totalRows: number;
  uniqueEmails: number;
  counts: VerifyCounts;
  verdicts: Record<string, { status: VerificationStatus; detail: VerificationDetail }>;
}

export async function streamVerification(args: {
  url: string;
  body: unknown;
  signal?: AbortSignal;
  onStart?: (total: number) => void;
  onProgress?: (progress: VerifyStreamProgress) => void;
}): Promise<VerifyStreamResult> {
  const response = await fetch(args.url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args.body),
    signal: args.signal,
  });
  if (!response.ok || !response.body) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? "Verification failed");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: VerifyStreamResult | null = null;

  const handleLine = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as {
      type: string;
      total?: number;
      done?: number;
      counts?: VerifyCounts;
      last?: { email: string; status: VerificationStatus };
      totalRows?: number;
      uniqueEmails?: number;
      verdicts?: VerifyStreamResult["verdicts"];
      error?: string;
    };
    if (event.type === "start") {
      args.onStart?.(event.total ?? 0);
    } else if (event.type === "progress" && event.counts && event.last) {
      args.onProgress?.({
        done: event.done ?? 0,
        total: event.total ?? 0,
        counts: event.counts,
        last: event.last,
      });
    } else if (event.type === "done" && event.counts && event.verdicts) {
      result = {
        totalRows: event.totalRows ?? 0,
        uniqueEmails: event.uniqueEmails ?? 0,
        counts: event.counts,
        verdicts: event.verdicts,
      };
    } else if (event.type === "error") {
      throw new Error(event.error ?? "Verification failed");
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      handleLine(line);
    }
  }
  if (buffer.trim()) {
    handleLine(buffer);
  }
  if (!result) {
    throw new Error("Verification ended without a result");
  }
  return result;
}
