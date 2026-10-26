"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { DemoBadge } from "@/components/ui";

interface ThreadMessage {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  fromEmail: string;
  toEmail: string;
  subject: string | null;
  body: string;
  occurredAt: string;
}

interface ThreadNote {
  id: string;
  body: string;
  createdAt: string;
  author: { id: string; name: string | null; email: string };
}

interface ThreadDetail {
  id: string;
  subject: string;
  status: string;
  classification: string | null;
  unread: boolean;
  lead: { id: string; email: string; fields: unknown } | null;
  campaign: { id: string; name: string } | null;
  sendingAccount: { id: string; email: string; provider: string; status: string } | null;
  assignee: { id: string; name: string | null; email: string } | null;
  messages: ThreadMessage[];
  notes: ThreadNote[];
}

const CLASSIFICATIONS = ["POSITIVE", "NEGATIVE", "OUT_OF_OFFICE", "REFERRAL", "NEUTRAL"];

/**
 * Conversation view: full message history, a reply composer that sends
 * through the thread's sending account, and the workspace controls
 * (status, assignee, classification override, internal notes). Notes
 * are internal only and are never sent anywhere.
 */
export function ThreadView({ threadId }: { threadId: string }) {
  const [thread, setThread] = useState<ThreadDetail | null>(null);
  const [demo, setDemo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [members, setMembers] = useState<Array<{ userId: string; name: string | null; email: string }>>([]);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/threads/${threadId}`);
      if (!response.ok) throw new Error("Could not load this conversation");
      const payload = (await response.json()) as { thread: ThreadDetail; demo: boolean };
      setThread(payload.thread);
      setDemo(payload.demo);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load this conversation");
    }
  }, [threadId]);

  useEffect(() => {
    void load();
    fetch("/api/team/members")
      .then((r) => (r.ok ? r.json() : { members: [] }))
      .then((payload: { members?: typeof members }) => setMembers(payload.members ?? []))
      .catch(() => undefined);
  }, [load]);

  async function patch(body: Record<string, unknown>, busyKey: string) {
    setBusy(busyKey);
    try {
      const response = await fetch(`/api/threads/${threadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? "Update failed");
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusy(null);
    }
  }

  async function sendReply(event: React.FormEvent) {
    event.preventDefault();
    setBusy("reply");
    try {
      const response = await fetch(`/api/threads/${threadId}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: reply }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Reply failed");
      setReply("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reply failed");
    } finally {
      setBusy(null);
    }
  }

  async function addNote(event: React.FormEvent) {
    event.preventDefault();
    setBusy("note");
    try {
      const response = await fetch(`/api/threads/${threadId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: note }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Note failed");
      setNote("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Note failed");
    } finally {
      setBusy(null);
    }
  }

  if (error && !thread) {
    return (
      <div className="mx-auto max-w-4xl">
        <Link href="/app/inbox" className="text-sm text-accent">Back to inbox</Link>
        <p className="mt-4 text-sm text-danger">{error}</p>
      </div>
    );
  }
  if (!thread) {
    return (
      <div className="mx-auto max-w-4xl">
        <p className="text-sm text-muted">Loading conversation...</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/app/inbox" className="text-sm text-accent">Back to inbox</Link>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <h1 className="font-display text-xl font-semibold tracking-tight">{thread.subject}</h1>
        {demo ? <DemoBadge /> : null}
      </div>
      <p className="mt-1 text-sm text-muted">
        {thread.lead ? `With ${thread.lead.email}` : "Sender is not a lead in this workspace"}
        {thread.campaign ? ` · campaign ${thread.campaign.name}` : ""}
        {thread.sendingAccount ? ` · via ${thread.sendingAccount.email} (${thread.sendingAccount.provider})` : ""}
      </p>
      {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}

      <div className="card mt-4 flex flex-wrap items-end gap-3 p-4">
        <label className="flex flex-col gap-1 text-xs text-muted">
          Status
          <select
            className="input"
            value={thread.status}
            onChange={(event) => patch({ status: event.target.value }, "status")}
            disabled={busy === "status"}
          >
            <option value="OPEN">Open</option>
            <option value="CLOSED">Closed</option>
            <option value="ARCHIVED">Archived</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Assignee
          <select
            className="input"
            value={thread.assignee?.id ?? ""}
            onChange={(event) => patch({ assigneeId: event.target.value || null }, "assignee")}
            disabled={busy === "assignee"}
          >
            <option value="">Unassigned</option>
            {members.map((member) => (
              <option key={member.userId} value={member.userId}>
                {member.name ?? member.email}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Classification (rule based, override freely)
          <select
            className="input"
            value={thread.classification ?? ""}
            onChange={(event) =>
              patch({ classification: event.target.value || null }, "classification")
            }
            disabled={busy === "classification"}
          >
            <option value="">None</option>
            {CLASSIFICATIONS.map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
        </label>
      </div>

      <ol className="mt-6 space-y-4">
        {thread.messages.map((message) => (
          <li
            key={message.id}
            className={`card p-4 ${message.direction === "INBOUND" ? "" : "border-accent/40"}`}
          >
            <p className="text-xs text-muted">
              {message.direction === "INBOUND" ? "From" : "Sent by"} {message.fromEmail} to{" "}
              {message.toEmail} · {new Date(message.occurredAt).toLocaleString()}
            </p>
            {message.subject ? <p className="mt-1 text-sm font-medium">{message.subject}</p> : null}
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{message.body}</p>
          </li>
        ))}
      </ol>

      <form onSubmit={sendReply} className="card mt-6 p-4">
        <label className="label" htmlFor="reply-body">
          Reply{demo ? " (DEMO: simulated send, nothing leaves the server)" : ""}
        </label>
        <textarea
          id="reply-body"
          className="input mt-2 min-h-28"
          value={reply}
          onChange={(event) => setReply(event.target.value)}
          placeholder="Write a reply to send from the thread's account..."
          required
        />
        <div className="mt-3 flex gap-3">
          <button type="submit" className="btn-primary" disabled={busy === "reply"}>
            {busy === "reply" ? "Sending..." : demo ? "Send simulated reply" : "Send reply"}
          </button>
        </div>
      </form>

      <section className="card mt-6 p-4">
        <h2 className="font-display text-sm font-semibold">Internal notes</h2>
        <p className="mt-1 text-xs text-muted">
          Visible only inside this workspace. Notes are never emailed or sent to the contact.
        </p>
        <ul className="mt-3 space-y-3">
          {thread.notes.map((entry) => (
            <li key={entry.id} className="rounded-lg bg-elevated p-3 text-sm">
              <p className="whitespace-pre-wrap">{entry.body}</p>
              <p className="mt-1 text-xs text-muted">
                {entry.author.name ?? entry.author.email} · {new Date(entry.createdAt).toLocaleString()}
              </p>
            </li>
          ))}
          {thread.notes.length === 0 ? (
            <li className="text-sm text-muted">No notes yet.</li>
          ) : null}
        </ul>
        <form onSubmit={addNote} className="mt-4">
          <textarea
            className="input min-h-20"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Add an internal note..."
            required
            aria-label="New internal note"
          />
          <button type="submit" className="btn-secondary mt-3" disabled={busy === "note"}>
            {busy === "note" ? "Adding..." : "Add note"}
          </button>
        </form>
      </section>
    </div>
  );
}
