"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { TOUR_STEPS, tourStepIndex } from "@/lib/tourSteps";

/**
 * First-run product tour (v1.6.0).
 *
 * Mounted once by the app layout, so it survives navigation between
 * app pages. It starts in three ways: automatically on the dashboard
 * for a user who has never completed it, at a specific step when the
 * URL carries ?tour=<stepId> (the dashboard checklist's "Show me"
 * links and the "Take the tour" button use this), and never again
 * automatically after completion. Finishing or skipping records
 * completion through POST /api/tour/complete; replaying does not.
 *
 * Each step navigates to its page, waits for the page's data-tour
 * anchor, scrolls it into view, and draws a highlight ring with a
 * dimmed backdrop. If an anchor never appears (an empty state
 * renders a different layout), the card shows centered instead, so
 * the explanation is never lost.
 */

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const CARD_WIDTH = 340;
const CARD_ESTIMATED_HEIGHT = 240;

export function ProductTour({ tourCompleted }: { tourCompleted: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [stepIndex, setStepIndex] = useState<number | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const autoStartedRef = useRef(false);
  const sessionDoneRef = useRef(false);
  const consumedParamRef = useRef<string | null>(null);

  const step = stepIndex !== null ? TOUR_STEPS[stepIndex] : null;

  // Start triggers: an explicit ?tour= link wins; otherwise the
  // dashboard auto-starts the tour once for a user who has not
  // completed it and has not already run it this session.
  useEffect(() => {
    const param = searchParams.get("tour");
    if (param) {
      if (consumedParamRef.current !== param) {
        consumedParamRef.current = param;
        const index = tourStepIndex(param);
        setStepIndex(index >= 0 ? index : 0);
      }
      return;
    }
    if (!tourCompleted && !autoStartedRef.current && !sessionDoneRef.current && pathname === "/app") {
      autoStartedRef.current = true;
      const timer = setTimeout(() => setStepIndex(0), 700);
      return () => clearTimeout(timer);
    }
  }, [searchParams, tourCompleted, pathname]);

  // Navigate to the step's page and track its anchor element.
  useEffect(() => {
    if (!step) {
      setRect(null);
      return;
    }
    if (pathname !== step.route) {
      router.push(step.route);
      return;
    }
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    let attempts = 0;

    const find = () => {
      if (cancelled) return;
      const element = document.querySelector(step.target);
      if (element) {
        element.scrollIntoView({ block: "center", behavior: "smooth" });
        const update = () => {
          const box = element.getBoundingClientRect();
          setRect({ top: box.top, left: box.left, width: box.width, height: box.height });
        };
        const timer = setTimeout(update, 380);
        window.addEventListener("resize", update);
        window.addEventListener("scroll", update, true);
        cleanup = () => {
          clearTimeout(timer);
          window.removeEventListener("resize", update);
          window.removeEventListener("scroll", update, true);
        };
        return;
      }
      attempts += 1;
      if (attempts < 25) {
        setTimeout(find, 150);
      } else {
        setRect(null);
      }
    };
    find();
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [step, pathname, router]);

  const close = (recordCompletion: boolean) => {
    sessionDoneRef.current = true;
    setStepIndex(null);
    setRect(null);
    if (recordCompletion) {
      void fetch("/api/tour/complete", { method: "POST", keepalive: true }).catch(() => undefined);
    }
    if (searchParams.get("tour")) {
      router.replace(pathname);
    }
  };

  const next = () => {
    if (stepIndex === null) return;
    if (stepIndex >= TOUR_STEPS.length - 1) {
      close(true);
    } else {
      setStepIndex(stepIndex + 1);
    }
  };

  const back = () => {
    if (stepIndex !== null && stepIndex > 0) {
      setStepIndex(stepIndex - 1);
    }
  };

  // Escape skips the tour, like the Skip button.
  useEffect(() => {
    if (stepIndex === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIndex, pathname, searchParams]);

  if (!step || stepIndex === null) {
    return null;
  }

  const cardStyle: React.CSSProperties = rect
    ? {
        width: CARD_WIDTH,
        left: Math.max(8, Math.min(rect.left, window.innerWidth - CARD_WIDTH - 8)),
        top:
          rect.top + rect.height + 12 + CARD_ESTIMATED_HEIGHT < window.innerHeight
            ? rect.top + rect.height + 12
            : Math.max(8, rect.top - CARD_ESTIMATED_HEIGHT - 12),
      }
    : {
        width: CARD_WIDTH,
        left: "50%",
        top: "50%",
        transform: "translate(-50%, -50%)",
      };

  return (
    <>
      <div className="fixed inset-0 z-[55]" aria-hidden="true" />
      {rect ? (
        <div
          className="pointer-events-none fixed z-[60] rounded-xl shadow-[0_0_0_9999px_rgba(2,6,23,0.6)] ring-2 ring-accent transition-all duration-300"
          style={{
            top: rect.top - 6,
            left: rect.left - 6,
            width: rect.width + 12,
            height: rect.height + 12,
          }}
          aria-hidden="true"
        />
      ) : (
        <div className="pointer-events-none fixed inset-0 z-[60] bg-slate-950/60" aria-hidden="true" />
      )}
      <section
        className="card fixed z-[70] p-5 shadow-xl"
        style={cardStyle}
        role="dialog"
        aria-modal="true"
        aria-label={`Product tour: ${step.title}`}
      >
        <p className="text-xs font-medium uppercase tracking-wide text-muted">
          Step {stepIndex + 1} of {TOUR_STEPS.length}
        </p>
        <h2 className="mt-1 font-display text-base font-semibold">{step.title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">{step.body}</p>
        <div className="mt-4 flex items-center justify-between gap-3">
          <button type="button" onClick={() => close(true)} className="text-sm font-medium text-muted hover:text-accent">
            Skip tour
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={back}
              disabled={stepIndex === 0}
              className="btn-secondary disabled:cursor-not-allowed disabled:opacity-40"
            >
              Back
            </button>
            <button type="button" onClick={next} className="btn-primary">
              {stepIndex >= TOUR_STEPS.length - 1 ? "Finish" : "Next"}
            </button>
          </div>
        </div>
      </section>
    </>
  );
}
