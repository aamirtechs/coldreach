"use client";

import { useEffect, useState } from "react";
import { Download, Share, X } from "lucide-react";

const DISMISS_KEY = "coldreach-install-dismissed-at";
const DISMISS_DAYS = 30;

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function recentlyDismissed(): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY) || 0);
    return at > 0 && Date.now() - at < DISMISS_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

function alreadyInstalled(): boolean {
  if (window.matchMedia("(display-mode: standalone)").matches) {
    return true;
  }
  return (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/**
 * Install offer for the PWA. Two shapes:
 * - Chromium (Android, desktop): captures beforeinstallprompt and
 *   shows a real Install button.
 * - iOS Safari: Apple has no install event, so the card explains
 *   Share, then Add to Home Screen.
 * Never shows inside the installed app, and a dismissal is honored
 * for 30 days.
 */
export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosHelp, setShowIosHelp] = useState(false);

  useEffect(() => {
    if (alreadyInstalled() || recentlyDismissed()) {
      return;
    }
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setDeferred(null);
      setShowIosHelp(false);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);

    const ua = window.navigator.userAgent;
    const isIos = /iphone|ipad|ipod/i.test(ua);
    const isSafari = isIos && !/crios|fxios/i.test(ua);
    if (isSafari) {
      setShowIosHelp(true);
    }
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {}
    setDeferred(null);
    setShowIosHelp(false);
  };

  const install = async () => {
    if (!deferred) {
      return;
    }
    await deferred.prompt();
    await deferred.userChoice;
    setDeferred(null);
  };

  if (!deferred && !showIosHelp) {
    return null;
  }

  return (
    <div className="fixed inset-x-3 bottom-24 z-40 sm:left-auto sm:right-6 sm:w-96 md:bottom-6">
      <div className="flex items-start gap-3 rounded-xl2 border border-line bg-surface p-4 shadow-pop">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent font-display text-xs font-bold text-white">
          CR
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Install ColdReach</p>
          {deferred ? (
            <>
              <p className="mt-0.5 text-sm text-muted">
                Add it to your home screen for a full screen, app style ColdReach.
              </p>
              <button type="button" onClick={install} className="btn-primary mt-3 px-3 py-1.5 text-sm">
                <Download className="h-4 w-4" aria-hidden="true" />
                Install
              </button>
            </>
          ) : (
            <p className="mt-0.5 flex items-start gap-1.5 text-sm text-muted">
              <Share className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                Tap Share, then <span className="font-medium text-fg">Add to Home Screen</span>, to
                use ColdReach like an app.
              </span>
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss install offer"
          className="rounded-lg p-1.5 text-muted hover:bg-elevated hover:text-fg"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
