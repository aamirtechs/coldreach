"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { renderTemplate, type LeadFields } from "@/lib/domain/personalize";

export interface StepDraft {
  subject: string;
  body: string;
  delayDays: number;
  delayHours: number;
}

interface SequenceBuilderProps {
  campaignId: string;
  initialSteps: StepDraft[];
  editable: boolean;
  sampleLead: { email: string; fields: Record<string, string> } | null;
  availableTokens: string[];
}

const TOKEN_SNIPPETS = ["firstName", "lastName", "company", "email"];

export function SequenceBuilder({
  campaignId,
  initialSteps,
  editable,
  sampleLead,
  availableTokens,
}: SequenceBuilderProps) {
  const router = useRouter();
  const [steps, setSteps] = useState<StepDraft[]>(
    initialSteps.length > 0
      ? initialSteps
      : [{ subject: "", body: "", delayDays: 0, delayHours: 0 }],
  );
  const [activeStep, setActiveStep] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fields: LeadFields = useMemo(
    () => (sampleLead ? { ...sampleLead.fields, email: sampleLead.email } : { email: "lead@example.com" }),
    [sampleLead],
  );

  const current = steps[activeStep];
  const previewSubject = current ? renderTemplate(current.subject, fields) : "";
  const previewBody = current ? renderTemplate(current.body, fields) : "";

  function update(index: number, patch: Partial<StepDraft>) {
    setSteps(steps.map((step, i) => (i === index ? { ...step, ...patch } : step)));
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= steps.length) return;
    const next = [...steps];
    [next[index], next[target]] = [next[target], next[index]];
    setSteps(next);
    setActiveStep(target);
  }

  function remove(index: number) {
    const next = steps.filter((_, i) => i !== index);
    setSteps(next.length > 0 ? next : [{ subject: "", body: "", delayDays: 0, delayHours: 0 }]);
    setActiveStep(Math.max(0, Math.min(activeStep, next.length - 1)));
  }

  function addStep() {
    setSteps([...steps, { subject: "", body: "", delayDays: 3, delayHours: 0 }]);
    setActiveStep(steps.length);
  }

  function insertToken(token: string) {
    if (!current) return;
    const snippet = token.includes("|") ? `{{${token}}}` : `{{${token}}}`;
    update(activeStep, { body: `${current.body}${current.body && !current.body.endsWith(" ") ? " " : ""}${snippet}` });
  }

  async function save() {
    setBusy(true);
    setNotice(null);
    const response = await fetch(`/api/campaigns/${campaignId}/steps`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ steps }),
    });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) {
      setNotice(data.error ?? "Could not save the sequence");
      return;
    }
    setNotice(`Sequence saved with ${data.steps.length} step(s).`);
    router.refresh();
  }

  return (
    <section className="card mt-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-lg font-semibold">Sequence</h2>
        {editable ? (
          <div className="flex gap-3">
            <button type="button" className="btn-secondary" onClick={addStep}>Add step</button>
            <button type="button" className="btn-primary" onClick={save} disabled={busy}>
              {busy ? "Saving..." : "Save sequence"}
            </button>
          </div>
        ) : (
          <span className="text-xs text-muted">Pause the campaign to edit the sequence.</span>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {steps.map((step, index) => (
          <button
            key={index}
            type="button"
            onClick={() => setActiveStep(index)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              index === activeStep ? "bg-accent text-white" : "bg-elevated text-muted hover:text-fg"
            }`}
          >
            Step {index + 1}
            {index > 0 ? ` · +${step.delayDays}d ${step.delayHours}h` : ""}
          </button>
        ))}
      </div>

      {current ? (
        <div className="mt-5 grid gap-6 lg:grid-cols-2">
          <div>
            <div className="flex items-center gap-3">
              <label className="text-sm font-medium" htmlFor="step-delay-days">Wait</label>
              <input
                id="step-delay-days"
                type="number"
                min={0}
                className="input w-20"
                value={current.delayDays}
                disabled={!editable}
                onChange={(e) => update(activeStep, { delayDays: Number(e.target.value) || 0 })}
              />
              <span className="text-sm text-muted">days</span>
              <input
                type="number"
                min={0}
                max={23}
                className="input w-20"
                value={current.delayHours}
                disabled={!editable}
                onChange={(e) => update(activeStep, { delayHours: Number(e.target.value) || 0 })}
                aria-label="Delay hours"
              />
              <span className="text-sm text-muted">hours after the previous step</span>
            </div>
            <label className="label mt-4" htmlFor="step-subject">Subject</label>
            <input
              id="step-subject"
              className="input"
              value={current.subject}
              disabled={!editable}
              onChange={(e) => update(activeStep, { subject: e.target.value })}
              placeholder="Quick question, {{firstName}}"
            />
            <label className="label mt-4" htmlFor="step-body">Body</label>
            <textarea
              id="step-body"
              className="input min-h-44"
              value={current.body}
              disabled={!editable}
              onChange={(e) => update(activeStep, { body: e.target.value })}
              placeholder={"Hi {{firstName|there}},\n\nI noticed {{company}} is hiring SDRs..."}
            />
            {editable ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted">Insert token:</span>
                {TOKEN_SNIPPETS.map((token) => (
                  <button key={token} type="button" className="rounded bg-elevated px-2 py-1 text-xs hover:text-accent" onClick={() => insertToken(token)}>
                    {`{{${token}}}`}
                  </button>
                ))}
                <button type="button" className="rounded bg-elevated px-2 py-1 text-xs hover:text-accent" onClick={() => insertToken("firstName|there")}>
                  {"{{firstName|there}}"}
                </button>
                {availableTokens
                  .filter((t) => !TOKEN_SNIPPETS.includes(t))
                  .slice(0, 6)
                  .map((token) => (
                    <button key={token} type="button" className="rounded bg-elevated px-2 py-1 text-xs hover:text-accent" onClick={() => insertToken(token)}>
                      {`{{${token}}}`}
                    </button>
                  ))}
              </div>
            ) : null}
            {editable ? (
              <div className="mt-4 flex gap-3">
                <button type="button" className="btn-ghost" onClick={() => move(activeStep, -1)} disabled={activeStep === 0}>Move up</button>
                <button type="button" className="btn-ghost" onClick={() => move(activeStep, 1)} disabled={activeStep === steps.length - 1}>Move down</button>
                <button type="button" className="btn-ghost" onClick={() => remove(activeStep)}>Remove step</button>
              </div>
            ) : null}
          </div>
          <div>
            <h3 className="text-sm font-semibold">
              Live preview{" "}
              <span className="font-normal text-muted">
                {sampleLead ? `rendered for ${sampleLead.email}` : "no leads in the attached list yet, showing token fallbacks"}
              </span>
            </h3>
            <div className="mt-3 rounded-lg border border-line bg-elevated p-4">
              <p className="text-sm font-semibold">{previewSubject || "(no subject)"}</p>
              <pre className="mt-3 whitespace-pre-wrap font-sans text-sm leading-relaxed">{previewBody || "(empty body)"}</pre>
            </div>
            <p className="mt-2 text-xs text-muted">
              Tokens without a value and without a fallback stay visible here exactly as they
              would block launch in preflight.
            </p>
          </div>
        </div>
      ) : null}
      {notice ? <p className="mt-4 text-sm text-muted">{notice}</p> : null}
    </section>
  );
}
