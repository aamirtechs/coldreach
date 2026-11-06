"use client";

import { useEffect, useState } from "react";
import { Eye, Paperclip, X } from "lucide-react";
import { CountryFlag } from "@/components/CountryFlag";
import { formatBytes } from "@/lib/attachments";

interface PreviewAttachment {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
}

interface Preview {
  to: string;
  company: string | null;
  campaignName: string;
  stepNumber: number;
  variantLabel: string;
  subject: string;
  fullText: string;
  attachments?: PreviewAttachment[];
  scheduledAt: string | null;
  timezone: string;
  country: { code: string; name: string; flag: string; state: string | null } | null;
}

/**
 * "Preview email" for one Upcoming sends row (v1.16.0). Fetches the
 * exact rendered copy for that enrollment from
 * GET /api/enrollments/[id]/preview (the same renderer the sending
 * worker uses) and shows it in a modal: recipient, subject, and the
 * complete plain-text email including signature and footer.
 */
export function UpcomingPreviewButton({ enrollmentId }: { enrollmentId: string }) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/enrollments/${enrollmentId}/preview`)
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (cancelled) return;
        if (!response.ok) {
          setError(data.error ?? "Preview could not be loaded");
          return;
        }
        setPreview(data.preview as Preview);
      })
      .catch(() => {
        if (!cancelled) setError("Preview could not be loaded");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, enrollmentId]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open ]);

  return (
    <>
      <button
        type="button"
        className="btn-secondary !px-2.5 !py-1 text-xs"
        onClick={() => setOpen(true)}
        aria-label="Preview the exact email that will be sent to this lead"
      >
        <Eye className="h-3.5 w-3.5" /> Preview email
      </button>
      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Email preview"
          onClick={() => setOpen(false)}
        >
          <div
            className="card max-h-[85vh] w-full max-w-2xl overflow-hidden"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
              <div>
                <h3 className="font-display text-base font-semibold">Exactly what will be sent</h3>
                <p className="mt-0.5 text-xs text-muted">
                  Rendered with this lead's real fields, the same way the sending worker renders it.
                  It changes only if you edit the sequence, signature, or lead before it sends.
                </p>
              </div>
              <button
                type="button"
                className="btn-ghost !p-1.5"
                onClick={() => setOpen(false)}
                aria-label="Close preview"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-[calc(85vh-89px)] overflow-y-auto px-6 py-4">
              {loading ? <p className="text-sm text-muted">Loading preview...</p> : null}
              {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
              {preview ? (
                <div className="space-y-3">
                  <dl className="grid gap-2 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-muted">To</dt>
                      <dd className="mt-0.5 font-medium">
                        {preview.country ? <CountryFlag code={preview.country.code} className="mr-1.5" /> : null}
                        {preview.to}
                        {preview.company ? <span className="font-normal text-muted"> · {preview.company}</span> : null}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-muted">Campaign · Step</dt>
                      <dd className="mt-0.5">
                        {preview.campaignName} · Step {preview.stepNumber}
                        {preview.variantLabel !== "A" ? ` · Variant ${preview.variantLabel}` : ""}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-muted">Subject</dt>
                      <dd className="mt-0.5 font-medium">{preview.subject}</dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-muted">Scheduled</dt>
                      <dd className="mt-0.5">
                        {preview.scheduledAt ? new Date(preview.scheduledAt).toLocaleString() : "Not scheduled"}
                        <span className="text-muted"> · {preview.timezone}</span>
                      </dd>
                    </div>
                  </dl>
                  {preview.attachments && preview.attachments.length > 0 ? (
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-muted">Attachments</p>
                      <ul className="mt-1 space-y-1">
                        {preview.attachments.map((attachment) => (
                          <li key={attachment.id} className="flex items-center gap-2 text-sm">
                            <Paperclip className="h-3.5 w-3.5 text-muted" />
                            <span className="font-medium">{attachment.filename}</span>
                            <span className="text-muted">{formatBytes(attachment.sizeBytes)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-muted">Email body</p>
                    <pre className="mt-1 whitespace-pre-wrap break-words rounded-lg bg-elevated p-4 font-sans text-sm leading-relaxed">
                      {preview.fullText}
                    </pre>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
