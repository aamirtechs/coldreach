"use client";

import { useRouter } from "next/navigation";

export function AccountActions({ accountId, status }: { accountId: string; status: string }) {
  const router = useRouter();

  async function setStatus(next: string) {
    await fetch(`/api/accounts/${accountId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    router.refresh();
  }

  async function remove() {
    if (!window.confirm("Remove this sending account? Campaigns using it keep their history but lose the account.")) {
      return;
    }
    await fetch(`/api/accounts/${accountId}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <span className="flex justify-end gap-2">
      {status === "CONNECTED" ? (
        <button type="button" className="btn-ghost !px-2 !py-1 text-xs" onClick={() => setStatus("PAUSED")}>Pause</button>
      ) : status === "PAUSED" ? (
        <button type="button" className="btn-ghost !px-2 !py-1 text-xs" onClick={() => setStatus("CONNECTED")}>Resume</button>
      ) : null}
      <button type="button" className="btn-ghost !px-2 !py-1 text-xs" onClick={remove}>Remove</button>
    </span>
  );
}
