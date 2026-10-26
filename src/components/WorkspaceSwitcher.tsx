"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Check, ChevronDown } from "lucide-react";

export interface WorkspaceOption {
  id: string;
  name: string;
  role: string;
}

/**
 * Topbar workspace switcher. Switching posts to /api/workspace/switch,
 * which verifies membership and re-issues the session token with the
 * new active workspace; a router refresh then re-renders every server
 * component against the new tenant.
 */
export function WorkspaceSwitcher({
  workspaces,
  activeId,
  activeName,
}: {
  workspaces: WorkspaceOption[];
  activeId: string;
  activeName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function switchTo(id: string) {
    if (id === activeId) {
      setOpen(false);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/workspace/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: id }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? "Switch failed");
      }
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Switch failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        className="flex items-center gap-2 rounded-lg border border-line bg-elevated px-3 py-1.5"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Switch workspace"
      >
        <Building2 className="h-4 w-4 text-muted" />
        <span className="max-w-48 truncate text-sm font-medium">{activeName}</span>
        <ChevronDown className="h-4 w-4 text-muted" />
      </button>
      {open ? (
        <div className="absolute left-0 z-20 mt-2 w-72 rounded-xl border border-line bg-surface p-2 shadow-lg">
          <p className="px-2 pb-1 pt-1 text-[11px] font-medium uppercase tracking-wide text-muted">
            Your workspaces
          </p>
          <ul role="listbox">
            {workspaces.map((workspace) => (
              <li key={workspace.id}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-elevated"
                  onClick={() => switchTo(workspace.id)}
                  disabled={busy}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{workspace.name}</span>
                    <span className="block text-xs text-muted">{workspace.role}</span>
                  </span>
                  {workspace.id === activeId ? <Check className="h-4 w-4 text-accent" /> : null}
                </button>
              </li>
            ))}
          </ul>
          {error ? <p className="px-2 pb-1 text-xs text-danger">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
