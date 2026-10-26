"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Create-workspace form and per-workspace switch buttons for the Agency page. */
export function CreateWorkspaceForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    setNotice(null);
    const response = await fetch("/api/workspace/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) {
      setNotice(data.error ?? "The workspace could not be created");
      return;
    }
    setNotice(`Workspace "${data.workspace.name}" created. You own it; switch to it any time from the topbar.`);
    setName("");
    router.refresh();
  }

  return (
    <div className="mt-4 flex flex-wrap items-end gap-3">
      <div>
        <label className="label" htmlFor="agency-workspace-name">New workspace name</label>
        <input
          id="agency-workspace-name"
          className="input w-72"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Client: Acme Outreach"
        />
      </div>
      <button type="button" className="btn-primary" onClick={create} disabled={busy || !name.trim()}>
        {busy ? "Creating..." : "Create workspace"}
      </button>
      {notice ? <p className="w-full text-sm text-muted">{notice}</p> : null}
    </div>
  );
}

export function SwitchWorkspaceButton({ workspaceId, current }: { workspaceId: string; current: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function switchTo() {
    setBusy(true);
    const response = await fetch("/api/workspace/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId }),
    });
    setBusy(false);
    if (response.ok) {
      router.push("/app");
      router.refresh();
    }
  }

  if (current) {
    return <span className="text-xs text-muted">Active workspace</span>;
  }
  return (
    <button type="button" className="btn-secondary !py-1.5 text-xs" onClick={switchTo} disabled={busy}>
      {busy ? "Switching..." : "Switch to workspace"}
    </button>
  );
}
