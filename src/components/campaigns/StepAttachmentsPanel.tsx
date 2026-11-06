"use client";

import { useEffect, useRef, useState } from "react";
import { Paperclip, Trash2 } from "lucide-react";
import { formatBytes, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_PER_STEP } from "@/lib/attachments";

interface StepAttachmentItem {
  id: string;
  stepOrder: number;
  filename: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
}

interface StepAttachmentsPanelProps {
  campaignId: string;
  stepOrder: number;
  stepNumber: number;
  editable: boolean;
}

const ACCEPT =
  ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.gif,.webp,.txt,.csv";

/**
 * Attachments for one sequence step (v1.19.0). Attachments save
 * immediately (they are not part of the Save sequence payload) and
 * belong to the step number, so they survive sequence edits; the
 * panel says so plainly because reordering steps keeps files with
 * the step position, not with the copy. Limits come from
 * src/lib/attachments.ts: 1 MB per file, 3 files per step.
 */
export function StepAttachmentsPanel({
  campaignId,
  stepOrder,
  stepNumber,
  editable,
}: StepAttachmentsPanelProps) {
  const [items, setItems] = useState<StepAttachmentItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/campaigns/${campaignId}/step-attachments`)
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (cancelled) return;
        if (!response.ok) {
          setError(data.error ?? "Attachments could not be loaded");
          setItems([]);
          return;
        }
        setItems(
          (data.attachments as StepAttachmentItem[]).filter((item) => item.stepOrder === stepOrder),
        );
      })
      .catch(() => {
        if (!cancelled) {
          setError("Attachments could not be loaded");
          setItems([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [campaignId, stepOrder]);

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    setError(null);
    for (const file of Array.from(files)) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        setError(`"${file.name}" is ${formatBytes(file.size)}. Attachments are limited to 1 MB per file.`);
        continue;
      }
      const form = new FormData();
      form.append("stepOrder", String(stepOrder));
      form.append("file", file);
      const response = await fetch(`/api/campaigns/${campaignId}/step-attachments`, {
        method: "POST",
        body: form,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error ?? `Could not attach "${file.name}"`);
        continue;
      }
      setItems((current) => [...(current ?? []), data.attachment as StepAttachmentItem]);
    }
    setBusy(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function remove(item: StepAttachmentItem) {
    setBusy(true);
    setError(null);
    const response = await fetch(
      `/api/campaigns/${campaignId}/step-attachments/${item.id}`,
      { method: "DELETE" },
    );
    const data = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) {
      setError(data.error ?? "Could not remove the attachment");
      return;
    }
    setItems((current) => (current ?? []).filter((entry) => entry.id !== item.id));
  }

  return (
    <div className="mt-6 rounded-lg border border-line p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <Paperclip className="h-4 w-4" /> Attachments, step {stepNumber}
      </h3>
      <p className="mt-1 text-xs text-muted">
        Files save immediately and ride on every send of this step. They stay with step{" "}
        {stepNumber} if you reorder or edit steps, so review them after moving steps around. Max
        1 MB per file, up to {MAX_ATTACHMENTS_PER_STEP} files. PDF, Word, Excel, PowerPoint,
        images, TXT, CSV.
      </p>
      {stepOrder === 0 ? (
        <p className="mt-1 text-xs text-warning">
          Attachments on a first cold email hurt deliverability. They work best on a follow-up
          step, after a lead shows interest.
        </p>
      ) : null}
      {items === null ? (
        <p className="mt-3 text-xs text-muted">Loading attachments...</p>
      ) : items.length === 0 ? (
        <p className="mt-3 text-xs text-muted">No files attached to this step yet.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-center justify-between gap-3 rounded bg-elevated px-3 py-2 text-sm"
            >
              <span className="min-w-0">
                <a
                  className="font-medium hover:text-accent"
                  href={`/api/campaigns/${campaignId}/step-attachments/${item.id}`}
                >
                  {item.filename}
                </a>{" "}
                <span className="text-xs text-muted">{formatBytes(item.sizeBytes)}</span>
              </span>
              {editable ? (
                <button
                  type="button"
                  className="btn-ghost !px-2 !py-1 text-xs"
                  onClick={() => remove(item)}
                  disabled={busy}
                  aria-label={`Remove ${item.filename}`}
                >
                  <Trash2 className="h-3.5 w-3.5" /> Remove
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {editable ? (
        <div className="mt-3">
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT}
            multiple
            className="hidden"
            onChange={(event) => upload(event.target.files)}
          />
          <button
            type="button"
            className="btn-secondary !py-1.5 text-xs"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy || (items !== null && items.length >= MAX_ATTACHMENTS_PER_STEP)}
          >
            {busy ? "Uploading..." : "Attach files"}
          </button>
          {items !== null && items.length >= MAX_ATTACHMENTS_PER_STEP ? (
            <span className="ml-2 text-xs text-muted">
              Step limit reached ({MAX_ATTACHMENTS_PER_STEP} files).
            </span>
          ) : null}
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted">Pause the campaign to change attachments.</p>
      )}
      {error ? <p className="mt-2 text-xs text-warning">{error}</p> : null}
    </div>
  );
}
