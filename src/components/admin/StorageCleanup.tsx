"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatBytes } from "@/lib/attachments";
import type {
  CleanupReplyClassification,
  CleanupStats,
} from "@/lib/admin/cleanup";

/**
 * Storage cleanup panel on the Platform Admin page (v1.31.0).
 *
 * Attachments: every step attachment on the platform, largest first,
 * with checkboxes and a select-all for the listed rows. Deleting one
 * removes the file from its campaign step, so future sends of that
 * step no longer carry it.
 *
 * Machine replies: one-click delete of every thread classified
 * AUTOMATED or NOT_FOUND, platform-wide. Human classifications are
 * not offered here and the API refuses them as well.
 *
 * Both actions ask for confirmation with exact counts before sending
 * anything, and the server requires its own confirm flag too.
 */

const REPLY_LABELS: Record<CleanupReplyClassification, { title: string; blurb: string }> = {
  AUTOMATED: {
    title: "Automated replies",
    blurb: "Ticket receipts, system notices, and other machine replies.",
  },
  NOT_FOUND: {
    title: "Not found replies",
    blurb: "Delivery failure notices for addresses that do not exist.",
  },
};

export function StorageCleanup() {
  const [stats, setStats] = useState<CleanupStats | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/admin/cleanup");
    if (!response.ok) {
      setError("Could not load the cleanup data.");
      return;
    }
    setStats((await response.json()) as CleanupStats);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const listedIds = useMemo(
    () => (stats ? stats.attachments.items.map((item) => item.id) : []),
    [stats],
  );
  const allListedSelected =
    listedIds.length > 0 && listedIds.every((id) => selected.has(id));
  const selectedBytes = useMemo(() => {
    if (!stats) return 0;
    return stats.attachments.items
      .filter((item) => selected.has(item.id))
      .reduce((sum, item) => sum + item.sizeBytes, 0);
  }, [stats, selected]);

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelected(next);
  }

  function toggleAll() {
    if (allListedSelected) {
      const next = new Set(selected);
      for (const id of listedIds) next.delete(id);
      setSelected(next);
    } else {
      setSelected(new Set([...selected, ...listedIds]));
    }
  }

  async function post(body: Record<string, unknown>): Promise<CleanupStats | null> {
    const response = await fetch("/api/admin/cleanup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await response.json().catch(() => ({}))) as {
      error?: string;
      stats?: CleanupStats;
    };
    if (!response.ok) {
      setError(data.error ?? "The delete failed. Nothing was changed.");
      return null;
    }
    return data.stats ?? null;
  }

  async function deleteSelectedAttachments() {
    if (selected.size === 0) return;
    const count = selected.size;
    if (
      !window.confirm(
        `Delete ${count} attachment${count === 1 ? "" : "s"} (${formatBytes(selectedBytes)})? ` +
          "The files are removed from their campaign steps and future sends will not include them. This cannot be undone.",
      )
    ) {
      return;
    }
    setBusy("attachments");
    setNotice(null);
    setError(null);
    try {
      const fresh = await post({
        action: "attachments.delete",
        ids: [...selected],
        confirm: true,
      });
      if (fresh) {
        setStats(fresh);
        setSelected(new Set());
        setNotice(
          `Deleted ${count} attachment${count === 1 ? "" : "s"}, freeing ${formatBytes(selectedBytes)}.`,
        );
      }
    } catch {
      setError("The delete failed. Nothing was changed.");
    } finally {
      setBusy(null);
    }
  }

  async function deleteReplies(classification: CleanupReplyClassification) {
    if (!stats) return;
    const bucket = stats.replies[classification];
    if (bucket.threads === 0) return;
    if (
      !window.confirm(
        `Delete all ${bucket.threads} ${REPLY_LABELS[classification].title.toLowerCase()} ` +
          `(${bucket.messages} messages) across every workspace? The conversations are removed permanently. This cannot be undone.`,
      )
    ) {
      return;
    }
    setBusy(classification);
    setNotice(null);
    setError(null);
    try {
      const fresh = await post({ action: "replies.delete", classification, confirm: true });
      if (fresh) {
        setStats(fresh);
        setNotice(
          `Deleted ${bucket.threads} ${REPLY_LABELS[classification].title.toLowerCase()} (${bucket.messages} messages).`,
        );
      }
    } catch {
      setError("The delete failed. Nothing was changed.");
    } finally {
      setBusy(null);
    }
  }

  if (!stats) {
    return <p className="mt-4 text-sm text-muted">Loading cleanup data...</p>;
  }

  return (
    <div className="mt-4">
      <p className="text-sm text-muted">
        {stats.databaseBytes !== null ? (
          <>
            Database size <span className="font-medium text-foreground">{formatBytes(stats.databaseBytes)}</span>.{" "}
          </>
        ) : null}
        Attachments hold{" "}
        <span className="font-medium text-foreground">{formatBytes(stats.attachments.totalBytes)}</span>{" "}
        in {stats.attachments.count} file{stats.attachments.count === 1 ? "" : "s"}. Freed space is
        reused by the database for new data.
      </p>

      {notice && <p className="mt-3 text-sm text-success">{notice}</p>}
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}

      <h3 className="mt-5 text-sm font-semibold">Attachments</h3>
      {stats.attachments.count === 0 ? (
        <p className="mt-2 text-sm text-muted">No attachments stored anywhere. Nothing to clean.</p>
      ) : (
        <>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="text-left text-muted">
                  <th className="py-2 pr-3 font-medium">
                    <input
                      type="checkbox"
                      checked={allListedSelected}
                      onChange={toggleAll}
                      aria-label="Select all listed attachments"
                    />
                  </th>
                  <th className="py-2 pr-3 font-medium">File</th>
                  <th className="py-2 pr-3 font-medium">Campaign</th>
                  <th className="py-2 pr-3 font-medium">Workspace</th>
                  <th className="py-2 pr-3 font-medium">Step</th>
                  <th className="py-2 text-right font-medium">Size</th>
                </tr>
              </thead>
              <tbody>
                {stats.attachments.items.map((item) => (
                  <tr key={item.id} className="border-t border-line">
                    <td className="py-2 pr-3">
                      <input
                        type="checkbox"
                        checked={selected.has(item.id)}
                        onChange={() => toggle(item.id)}
                        aria-label={`Select ${item.filename}`}
                      />
                    </td>
                    <td className="py-2 pr-3 font-medium">{item.filename}</td>
                    <td className="py-2 pr-3 text-muted">{item.campaignName}</td>
                    <td className="py-2 pr-3 text-muted">{item.workspaceName}</td>
                    <td className="py-2 pr-3 text-muted">{item.stepOrder + 1}</td>
                    <td className="py-2 text-right">{formatBytes(item.sizeBytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {stats.attachments.truncated ? (
            <p className="mt-2 text-xs text-muted">
              Showing the {stats.attachments.items.length} largest of {stats.attachments.count}{" "}
              attachments. Delete some and the list refills.
            </p>
          ) : null}
          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              className="btn-secondary"
              disabled={selected.size === 0 || busy !== null}
              onClick={deleteSelectedAttachments}
            >
              {busy === "attachments"
                ? "Deleting..."
                : `Delete selected (${selected.size}, ${formatBytes(selectedBytes)})`}
            </button>
            <span className="text-xs text-muted">
              Deleted files leave their campaign steps, so future sends will not carry them.
            </span>
          </div>
        </>
      )}

      <h3 className="mt-6 text-sm font-semibold">Machine replies</h3>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        {(Object.keys(REPLY_LABELS) as CleanupReplyClassification[]).map((classification) => {
          const bucket = stats.replies[classification];
          return (
            <div key={classification} className="rounded border border-line p-4">
              <p className="text-sm font-medium">{REPLY_LABELS[classification].title}</p>
              <p className="mt-1 text-xs text-muted">{REPLY_LABELS[classification].blurb}</p>
              <p className="mt-2 text-sm">
                {bucket.threads} conversation{bucket.threads === 1 ? "" : "s"},{" "}
                {bucket.messages} message{bucket.messages === 1 ? "" : "s"}
              </p>
              <button
                type="button"
                className="btn-secondary mt-3"
                disabled={bucket.threads === 0 || busy !== null}
                onClick={() => deleteReplies(classification)}
              >
                {busy === classification ? "Deleting..." : "Delete all"}
              </button>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-muted">
        Only machine replies can be deleted here. Human replies and every other kind stay untouched.
      </p>
    </div>
  );
}
