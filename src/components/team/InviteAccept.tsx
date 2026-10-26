"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Accept button for the invite page. The API verifies the signed-in
 * account's email matches the invitation, joins the workspace with
 * the invited role, and switches the session to it; on success we go
 * straight to the dashboard of the joined workspace.
 */
export function InviteAccept({ token }: { token: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/invites/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Could not accept the invitation");
      }
      router.push("/app");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not accept the invitation");
      setBusy(false);
    }
  }

  return (
    <div>
      <button type="button" className="btn-primary" onClick={accept} disabled={busy}>
        {busy ? "Joining..." : "Accept invitation"}
      </button>
      {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
    </div>
  );
}
