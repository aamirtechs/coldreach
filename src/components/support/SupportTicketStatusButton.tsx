"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function SupportTicketStatusButton({
  ticketId,
  status,
}: {
  ticketId: string;
  status: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const next = status === "OPEN" ? "CLOSED" : "OPEN";

  async function toggle() {
    setBusy(true);
    const response = await fetch("/api/admin/support-tickets", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: ticketId, status: next }),
    });
    setBusy(false);
    if (response.ok) {
      router.refresh();
    }
  }

  return (
    <button type="button" className="btn-secondary" disabled={busy} onClick={toggle}>
      {busy ? "Saving..." : status === "OPEN" ? "Close" : "Reopen"}
    </button>
  );
}
