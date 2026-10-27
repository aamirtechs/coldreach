/**
 * Structured application logger.
 *
 * One JSON object per line on stdout (stderr for errors), with a
 * stable shape: { ts, level, msg, requestId?, workspaceId?, ... }.
 * Platform log drains (Vercel, or any collector pointed at the
 * process output) can parse every line without a custom format.
 *
 * Optional error tracking: when SENTRY_DSN is set, error level
 * entries are also forwarded to Sentry's envelope endpoint with a
 * plain fetch. No SDK and no new dependency; the forwarder is small
 * on purpose, and a failure to forward never affects the request
 * path (fire and forget, errors swallowed). When SENTRY_DSN is
 * unset the logger is stdout only and the integration point is
 * forwardErrorToSentry below.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogFields {
  requestId?: string;
  workspaceId?: string;
  [key: string]: unknown;
}

export interface LogEntry extends LogFields {
  ts: string;
  level: LogLevel;
  msg: string;
}

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function minLevel(): number {
  const configured = (process.env.LOG_LEVEL ?? "info").toLowerCase() as LogLevel;
  return LEVELS[configured] ?? LEVELS.info;
}

/** A correlation id for one unit of work (a tick, a request). */
export function newRequestId(): string {
  return globalThis.crypto.randomUUID();
}

export function formatLogLine(entry: LogEntry): string {
  return JSON.stringify(entry);
}

function serializeError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}

/** Builds the log entry object (pure; the emit step is separate). */
export function buildLogEntry(level: LogLevel, msg: string, fields: LogFields = {}): LogEntry {
  const { error, ...rest } = fields;
  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...rest,
  };
  if (error !== undefined) {
    entry.error = serializeError(error);
  }
  return entry;
}

export interface SentryDsn {
  publicKey: string;
  host: string;
  projectId: string;
  /** The envelope ingestion URL for this DSN. */
  envelopeUrl: string;
  /** Sentry auth header value for envelope posts. */
  authHeader: string;
}

/** Parses a Sentry DSN of the form https://<key>@<host>/<projectId>. */
export function parseSentryDsn(dsn: string): SentryDsn | null {
  try {
    const url = new URL(dsn);
    const projectId = url.pathname.replace(/^\//, "");
    if (!url.username || !projectId) {
      return null;
    }
    return {
      publicKey: url.username,
      host: url.host,
      projectId,
      envelopeUrl: `${url.protocol}//${url.host}/api/${projectId}/envelope/`,
      authHeader: `Sentry sentry_version=7, sentry_key=${url.username}, sentry_client=coldreach-log/1.0`,
    };
  } catch {
    return null;
  }
}

/**
 * Builds the three-line Sentry envelope for one error entry:
 * envelope header, item header, event payload. Pure, for tests.
 */
export function buildSentryEnvelope(dsn: string, entry: LogEntry): string | null {
  const parsed = parseSentryDsn(dsn);
  if (!parsed) {
    return null;
  }
  const eventId = globalThis.crypto.randomUUID().replace(/-/g, "");
  const envelopeHeader = {
    event_id: eventId,
    sent_at: entry.ts,
    dsn,
  };
  const itemHeader = { type: "event" };
  const payload = {
    event_id: eventId,
    timestamp: entry.ts,
    level: "error",
    logger: "coldreach",
    platform: "node",
    message: entry.msg,
    extra: {
      ...(entry.error ? { error: entry.error } : {}),
      ...(entry.requestId ? { requestId: entry.requestId } : {}),
      ...(entry.workspaceId ? { workspaceId: entry.workspaceId } : {}),
    },
  };
  return [JSON.stringify(envelopeHeader), JSON.stringify(itemHeader), JSON.stringify(payload)].join(
    "\n",
  );
}

function forwardErrorToSentry(entry: LogEntry): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    return;
  }
  const parsed = parseSentryDsn(dsn);
  const body = buildSentryEnvelope(dsn, entry);
  if (!parsed || !body) {
    return;
  }
  // Fire and forget: telemetry must never block or break the caller.
  void fetch(parsed.envelopeUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-sentry-envelope",
      "X-Sentry-Auth": parsed.authHeader,
    },
    body,
  }).catch(() => undefined);
}

function emit(entry: LogEntry): void {
  const line = formatLogLine(entry);
  if (entry.level === "error") {
    process.stderr.write(`${line}\n`);
    forwardErrorToSentry(entry);
  } else {
    process.stdout.write(`${line}\n`);
  }
}

export function log(level: LogLevel, msg: string, fields: LogFields = {}): void {
  if (LEVELS[level] < minLevel()) {
    return;
  }
  emit(buildLogEntry(level, msg, fields));
}

export const logger = {
  debug: (msg: string, fields?: LogFields) => log("debug", msg, fields),
  info: (msg: string, fields?: LogFields) => log("info", msg, fields),
  warn: (msg: string, fields?: LogFields) => log("warn", msg, fields),
  error: (msg: string, fields?: LogFields) => log("error", msg, fields),
};
