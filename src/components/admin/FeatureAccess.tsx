"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Feature access switches for the platform admin panel (v1.36.0).
 * One switch today: email verification is owner-only by default;
 * turning this on opens the Verify Emails tool, list verification
 * and the import wizard's verify step to every signed-in user.
 * The platform owner keeps access either way.
 */
export function FeatureAccess() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/settings");
      const data = (await response.json().catch(() => ({}))) as {
        verificationPublicEnabled?: boolean;
        error?: string;
      };
      if (!response.ok || typeof data.verificationPublicEnabled !== "boolean") {
        setError(data.error ?? "Could not load the feature switches");
        return;
      }
      setEnabled(data.verificationPublicEnabled);
    } catch {
      setError("Could not load the feature switches");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(next: boolean) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verificationPublicEnabled: next }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        verificationPublicEnabled?: boolean;
        error?: string;
      };
      if (!response.ok || typeof data.verificationPublicEnabled !== "boolean") {
        setError(data.error ?? "Could not update the switch");
        return;
      }
      setEnabled(data.verificationPublicEnabled);
    } catch {
      setError("Could not update the switch");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={enabled ?? false}
          disabled={enabled === null || busy}
          onChange={(e) => void toggle(e.target.checked)}
        />
        <span>
          <span className="font-medium">Email verification for all users</span>
          <span className="block text-xs text-muted">
            Off: only you can use the Verify Emails tool, list verification and the import
            wizard&apos;s verify step; other users see a Coming soon label. On: every signed-in
            user can verify. You keep access either way.
          </span>
        </span>
      </label>
      {enabled !== null ? (
        <p className="mt-2 text-xs text-muted" role="status">
          Currently {enabled ? "on: verification is open to all users." : "off: verification is owner-only."}
        </p>
      ) : null}
      {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
    </div>
  );
}
