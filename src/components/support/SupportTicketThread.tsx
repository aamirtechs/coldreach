"use client";

import { useCallback, useEffect, useState } from "react";
import { supportTicketReplyKindLabel } from "@/lib/support/constants";

/**
 * One ticket's thread in the platform admin panel (v1.25.0): the
 * replies and internal notes written on the ticket, plus the
 * composer. A REPLY is emailed to the reporter unless the email
 * checkbox is cleared; a NOTE never leaves the panel. The thread
 * loads when the ticket's detail opens and reloads after a save,
 * so the emailed marker shown here always reflects the stored row.
 */

interface ThreadReply {
  id: string;
  kind: string;
  body: string;
  authorEmail: string;
  emailedAt: string | null;
  createdAt: string;
}

function formatDateTime(iso: string): string {
  return `${iso.slice(0, 16).replace("T", " ")} UTC`;
}

export function SupportTicketThread({
  ticketId,
  reporterEmail,
}: {
  ticketId: string;
  reporterEmail: string;
}) {
  const [replies, setReplies] = useState<ThreadReply[] | null>(null);
  const [body, setBody] = useState("");
  const [kind, setKind] = useState<"REPLY" | "NOTE">("REPLY");
  const [emailCustomer, setEmailCustomer] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch(`/api/admin/support-tickets/${ticketId}/replies`);
    if (response.ok) {
      const data = await response.json();
      setReplies(data.replies ?? []);
    } else {
      setReplies([]);
    }
  }, [ticketId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    const response = await fetch(`/api/admin/support-tickets/${ticketId}/replies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, body, emailCustomer }),
    });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) {
      setNotice(data.error ?? "Could not save the reply");
      return;
    }
    setBody("");
    setNotice(
      kind === "NOTE"
        ? "Internal note saved."
        : data.emailSent
          ? `Reply saved and emailed to ${reporterEmail}.`
          : "Reply saved. The email did not send, so the customer has not seen it yet.",
    );
    void load();
  }

  return (
    <div className="mt-5 border-t border-line pt-4">
      <p className="text-xs font-medium text-muted">Replies and notes</p>
      {replies === null ? (
        <p className="mt-2 text-sm text-muted">Loading the thread...</p>
      ) : replies.length === 0 ? (
        <p className="mt-2 text-sm text-muted">No replies or notes yet.</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {replies.map((reply) => (
            <li key={reply.id} className="rounded-md border border-line p-3">
              <p className="text-xs text-muted">
                <span className="font-medium text-foreground">
                  {supportTicketReplyKindLabel(reply.kind)}
                </span>{" "}
                by {reply.authorEmail} · {formatDateTime(reply.createdAt)}
                {reply.kind === "REPLY" ? (
                  reply.emailedAt ? (
                    <> · Emailed to the customer</>
                  ) : (
                    <> · Not emailed</>
                  )
                ) : null}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{reply.body}</p>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={submit} className="mt-4">
        <label className="label" htmlFor={`reply-body-${ticketId}`}>
          Add a reply or an internal note
        </label>
        <textarea
          id={`reply-body-${ticketId}`}
          className="input min-h-24"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Write the reply the customer will read, or a note only the team sees."
        />
        <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
          <label className="flex items-center gap-2">
            <span className="text-muted">Type</span>
            <select
              className="input w-auto"
              value={kind}
              onChange={(e) => setKind(e.target.value as "REPLY" | "NOTE")}
            >
              <option value="REPLY">Reply to customer</option>
              <option value="NOTE">Internal note</option>
            </select>
          </label>
          {kind === "REPLY" ? (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={emailCustomer}
                onChange={(e) => setEmailCustomer(e.target.checked)}
              />
              <span>Email this reply to {reporterEmail}</span>
            </label>
          ) : null}
          <button type="submit" className="btn-primary" disabled={busy || body.trim() === ""}>
            {busy ? "Saving..." : kind === "REPLY" ? "Send reply" : "Save note"}
          </button>
        </div>
        {notice ? <p className="mt-2 text-sm text-muted">{notice}</p> : null}
      </form>
    </div>
  );
}
