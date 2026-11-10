"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SUPPORT_CATEGORIES, MAX_TICKET_MESSAGE_LENGTH, MAX_TICKET_SUBJECT_LENGTH } from "@/lib/support/constants";

export function SupportTicketForm() {
  const router = useRouter();
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState<string>(SUPPORT_CATEGORIES[0]);
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    setError(null);
    const response = await fetch("/api/support/tickets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject, category, message }),
    });
    const data = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) {
      setError(data.error ?? "Could not send your ticket. Please try again.");
      return;
    }
    setSubject("");
    setMessage("");
    setNotice("Ticket created. We usually reply by email within one business day.");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="card p-6">
      <h2 className="font-display text-lg font-semibold">Create a ticket</h2>
      <p className="mt-1 text-sm text-muted">
        Tell us what is happening and we will reply to your account email. Your workspace and
        account details are attached automatically.
      </p>
      <div className="mt-4 grid gap-4">
        <div>
          <label className="label" htmlFor="ticket-subject">Subject</label>
          <input
            id="ticket-subject"
            className="input"
            value={subject}
            maxLength={MAX_TICKET_SUBJECT_LENGTH}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Short summary of the problem"
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="ticket-category">Category</label>
          <select
            id="ticket-category"
            className="input"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {SUPPORT_CATEGORIES.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="ticket-message">Message</label>
          <textarea
            id="ticket-message"
            className="input min-h-32"
            value={message}
            maxLength={MAX_TICKET_MESSAGE_LENGTH}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="What happened, what you expected, and any campaign or account names involved"
            required
          />
        </div>
      </div>
      {error ? (
        <p className="mt-4 rounded-lg border border-amber-500/40 p-3 text-sm" role="alert">{error}</p>
      ) : null}
      {notice ? (
        <p className="mt-4 rounded-lg border border-emerald-500/40 p-3 text-sm" role="status">{notice}</p>
      ) : null}
      <div className="mt-5">
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? "Sending..." : "Create ticket"}
        </button>
      </div>
    </form>
  );
}
