"use client";

import { useState } from "react";
import type { AccountDeletionSummary } from "@/lib/auth/deleteAccount";

/**
 * Danger zone: account deletion (v1.15.0). Shows exactly which
 * workspaces will be deleted with their data counts, warns that
 * everything goes (campaigns, leads, emails, sending accounts) and
 * that it cannot be undone, and requires the account password plus
 * typing DELETE before the button arms.
 */
export function DeleteAccountPanel({ summary }: { summary: AccountDeletionSummary }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const armed = confirmation === "DELETE" && password.length > 0 && !deleting;

  async function onDelete() {
    setError(null);
    setDeleting(true);
    try {
      const response = await fetch("/api/auth/delete-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, confirmation }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(data.error ?? "Could not delete the account. Please try again.");
        return;
      }
      window.location.href = "/";
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <section className="card mt-6 border-danger/40 p-6" data-tour="danger-zone">
      <h2 className="font-display text-lg font-semibold tracking-tight text-danger">
        Danger zone
      </h2>
      <p className="mt-1 text-sm text-muted">
        Delete your ColdReach account permanently.
      </p>
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="btn-ghost mt-4 border-danger/40 px-4 py-2 text-danger"
        >
          Delete my account
        </button>
      ) : (
        <div className="mt-4 space-y-4">
          {summary.deleteWorkspaces.length > 0 ? (
            <div className="rounded-lg bg-danger/10 px-4 py-3 text-sm">
              <p className="font-medium text-danger">
                Warning: this deletes everything in the following workspace
                {summary.deleteWorkspaces.length > 1 ? "s" : ""}, permanently:
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {summary.deleteWorkspaces.map((workspace) => (
                  <li key={workspace.id}>
                    <strong>{workspace.name}</strong>: {workspace.campaigns} campaigns,{" "}
                    {workspace.leads} leads, {workspace.sendingAccounts} sending accounts, and all
                    enrollments, sequences, sent and received emails, suppressions, API keys, and
                    settings in it.
                  </li>
                ))}
              </ul>
              <p className="mt-2">
                Nothing can be recovered after deletion. Export anything you need from Settings
                first.
              </p>
            </div>
          ) : (
            <p className="rounded-lg bg-danger/10 px-4 py-3 text-sm text-danger">
              Warning: your account will be deleted permanently.
            </p>
          )}
          {summary.leaveWorkspaces.length > 0 ? (
            <p className="text-sm text-muted">
              Workspaces you share with other members are not deleted:{" "}
              {summary.leaveWorkspaces.map((w) => w.name).join(", ")}. You will simply be removed
              from them.
            </p>
          ) : null}
          <div>
            <label className="label" htmlFor="delete-password">
              Your password
            </label>
            <input
              id="delete-password"
              type="password"
              className="input"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
            />
          </div>
          <div>
            <label className="label" htmlFor="delete-confirmation">
              Type DELETE to confirm
            </label>
            <input
              id="delete-confirmation"
              className="input"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="off"
            />
          </div>
          {error && (
            <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
          <div className="flex gap-3">
            <button
              type="button"
              disabled={!armed}
              onClick={onDelete}
              className="btn-primary bg-danger px-4 py-2"
            >
              {deleting ? "Deleting" : "Permanently delete my account"}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="btn-ghost px-4 py-2"
              disabled={deleting}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
