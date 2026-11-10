"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  SUPPORT_TICKET_STATUSES,
  SUPPORT_TICKET_STATUS_LABELS,
} from "@/lib/support/constants";

/**
 * Status control for one ticket in the platform admin panel.
 *
 * A select offering every ticket status (Open, Under Process,
 * Closed), PATCHing the admin endpoint on change. The value comes
 * from the server render, so after a successful save the router
 * refresh shows the stored status everywhere on the page.
 */
export function SupportTicketStatusSelect({
  ticketId,
  status,
}: {
  ticketId: string;
  status: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function change(next: string) {
    if (next === status) return;
    setBusy(true);
    setError("");
    const response = await fetch("/api/admin/support-tickets", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: ticketId, status: next }),
    });
    setBusy(false);
    if (response.ok) {
      router.refresh();
    } else {
      setError("Could not save the status. Try again.");
    }
  }

  return (
    <span className="block">
      <select
        className="input w-40"
        value={status}
        disabled={busy}
        onChange={(event) => change(event.target.value)}
        aria-label="Ticket status"
      >
        {SUPPORT_TICKET_STATUSES.map((value) => (
          <option key={value} value={value}>
            {SUPPORT_TICKET_STATUS_LABELS[value]}
          </option>
        ))}
      </select>
      {error ? <span className="mt-1 block text-xs text-danger">{error}</span> : null}
    </span>
  );
}
