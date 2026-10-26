"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { renderTemplate, type LeadFields } from "@/lib/domain/personalize";

export interface VariantDraft {
  label: string;
  subject: string;
  bodyText: string;
  bodyHtml: string;
  weight: number;
}

export interface StepDraft {
  subject: string;
  body: string;
  delayDays: number;
  delayHours: number;
  variants: VariantDraft[];
}

interface SequenceBuilderProps {
  campaignId: string;
  campaignName: string;
  initialSteps: StepDraft[];
  editable: boolean;
  sampleLead: { email: string; fields: Record<string, string> } | null;
  availableTokens: string[];
}

const TOKEN_SNIPPETS = ["firstName", "lastName", "company", "email"];
const VARIANT_LABELS = ["B", "C"];
const REWRITE_PRESETS = ["shorter", "more direct", "friendlier"] as const;

interface AiStatus {
  configured: boolean;
  missingEnv: string[];
}

export function SequenceBuilder({
  campaignId,
  campaignName,
  initialSteps,
  editable,
  sampleLead,
  availableTokens,
}: SequenceBuilderProps) {
  const router = useRouter();
  const [steps, setSteps] = useState<StepDraft[]>(
    initialSteps.length > 0
      ? initialSteps
      : [{ subject: "", body: "", delayDays: 0, delayHours: 0, variants: [] }],
  );
  const [activeStep, setActiveStep] = useState(0);
  const [activeVariant, setActiveVariant] = useState<string>("A");
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const [subjectIdeas, setSubjectIdeas] = useState<string[] | null>(null);
  const [aiBusy, setAiBusy] = useState<string | null>(null);
  const [rewriteResult, setRewriteResult] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/ai/status")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled && data) {
          setAiStatus({ configured: Boolean(data.configured), missingEnv: data.missingEnv ?? [] });
        }
      })
      .catch(() => {
        if (!cancelled) setAiStatus({ configured: false, missingEnv: ["OPENAI_API_KEY"] });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const fields: LeadFields = useMemo(
    () => (sampleLead ? { ...sampleLead.fields, email: sampleLead.email } : { email: "lead@example.com" }),
    [sampleLead],
  );

  const current = steps[activeStep];
  const currentVariant: VariantDraft | null =
    current && activeVariant !== "A"
      ? (current.variants.find((variant) => variant.label === activeVariant) ?? null)
      : null;
  const editorSubject = current ? (currentVariant ? currentVariant.subject : current.subject) : "";
  const editorBody = current ? (currentVariant ? currentVariant.bodyText : current.body) : "";
  const previewSubject = current
    ? renderTemplate(currentVariant ? currentVariant.subject || current.subject : current.subject, fields)
    : "";
  const previewBody = current ? renderTemplate(editorBody, fields) : "";

  function update(index: number, patch: Partial<StepDraft>) {
    setSteps(steps.map((step, i) => (i === index ? { ...step, ...patch } : step)));
  }

  function updateVariant(index: number, label: string, patch: Partial<VariantDraft>) {
    const step = steps[index];
    update(index, {
      variants: step.variants.map((variant) =>
        variant.label === label ? { ...variant, ...patch } : variant,
      ),
    });
  }

  function updateEditor(patch: { subject?: string; body?: string }) {
    if (!current) return;
    if (currentVariant) {
      updateVariant(activeStep, currentVariant.label, {
        ...(patch.subject !== undefined ? { subject: patch.subject } : {}),
        ...(patch.body !== undefined ? { bodyText: patch.body } : {}),
      });
    } else {
      update(activeStep, patch);
    }
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
    setSteps(next.length > 0 ? next : [{ subject: "", body: "", delayDays: 0, delayHours: 0, variants: [] }]);
    setActiveStep(Math.max(0, Math.min(activeStep, next.length - 1)));
    setActiveVariant("A");
  }

  function addStep() {
    setSteps([...steps, { subject: "", body: "", delayDays: 3, delayHours: 0, variants: [] }]);
    setActiveStep(steps.length);
    setActiveVariant("A");
  }

  function addVariant() {
    if (!current || current.variants.length >= VARIANT_LABELS.length) return;
    const label = VARIANT_LABELS[current.variants.length];
    update(activeStep, {
      variants: [
        ...current.variants,
        { label, subject: "", bodyText: "", bodyHtml: "", weight: 1 },
      ],
    });
    setActiveVariant(label);
  }

  function removeVariant(label: string) {
    if (!current) return;
    const remaining = current.variants
      .filter((variant) => variant.label !== label)
      .map((variant, i) => ({ ...variant, label: VARIANT_LABELS[i] }));
    update(activeStep, { variants: remaining });
    setActiveVariant("A");
  }

  function insertToken(token: string) {
    updateEditor({ body: `${editorBody}${editorBody && !editorBody.endsWith(" ") ? " " : ""}{{${token}}}` });
  }

  async function fetchSubjectIdeas() {
    if (!current) return;
    setAiBusy("subjects");
    setAiError(null);
    setSubjectIdeas(null);
    const response = await fetch("/api/ai/subjects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        campaignName,
        currentSubject: current.subject,
        body: current.body,
        count: 5,
      }),
    });
    const data = await response.json();
    setAiBusy(null);
    if (!response.ok) {
      setAiError(data.error ?? "Subject suggestions failed");
      return;
    }
    setSubjectIdeas(data.subjects ?? []);
  }

  async function fetchRewrite(instruction: string) {
    if (!current) return;
    setAiBusy(`rewrite:${instruction}`);
    setAiError(null);
    setRewriteResult(null);
    const response = await fetch("/api/ai/rewrite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: editorBody, instruction }),
    });
    const data = await response.json();
    setAiBusy(null);
    if (!response.ok) {
      setAiError(data.error ?? "Rewrite failed");
      return;
    }
    setRewriteResult(data.body ?? "");
  }

  async function save() {
    setBusy(true);
    setNotice(null);
    const response = await fetch(`/api/campaigns/${campaignId}/steps`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        steps: steps.map((step) => ({
          subject: step.subject,
          body: step.body,
          delayDays: step.delayDays,
          delayHours: step.delayHours,
          variants: step.variants.map((variant) => ({
            subject: variant.subject,
            bodyText: variant.bodyText,
            bodyHtml: variant.bodyHtml || undefined,
            weight: variant.weight,
          })),
        })),
      }),
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

  const variantTabs = current ? ["A", ...current.variants.map((variant) => variant.label)] : ["A"];

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
            onClick={() => {
              setActiveStep(index);
              setActiveVariant("A");
              setSubjectIdeas(null);
              setRewriteResult(null);
            }}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              index === activeStep ? "bg-accent text-white" : "bg-elevated text-muted hover:text-fg"
            }`}
          >
            Step {index + 1}
            {index > 0 ? ` · +${step.delayDays}d ${step.delayHours}h` : ""}
            {step.variants.length > 0 ? ` · A/B${step.variants.length > 1 ? "/C" : ""}` : ""}
          </button>
        ))}
      </div>

      {current ? (
        <>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">Variant</span>
            {variantTabs.map((label) => (
              <button
                key={label}
                type="button"
                onClick={() => {
                  setActiveVariant(label);
                  setRewriteResult(null);
                }}
                className={`rounded-lg px-3 py-1 text-sm font-medium ${
                  label === activeVariant ? "bg-accent text-white" : "bg-elevated text-muted hover:text-fg"
                }`}
              >
                {label}
                {label === "A" ? " (original)" : ""}
              </button>
            ))}
            {editable && current.variants.length < VARIANT_LABELS.length ? (
              <button type="button" className="btn-ghost !px-2 !py-1 text-xs" onClick={addVariant}>
                Add variant {VARIANT_LABELS[current.variants.length]}
              </button>
            ) : null}
            {currentVariant ? (
              <span className="flex items-center gap-2 text-xs text-muted">
                <label htmlFor="variant-weight">Traffic weight</label>
                <input
                  id="variant-weight"
                  type="number"
                  min={1}
                  className="input w-16 !py-1"
                  value={currentVariant.weight}
                  disabled={!editable}
                  onChange={(e) =>
                    updateVariant(activeStep, currentVariant.label, {
                      weight: Math.max(1, Number(e.target.value) || 1),
                    })
                  }
                />
                <span>variant A has weight 1; sends split proportionally and each enrollment keeps its variant</span>
                {editable ? (
                  <button
                    type="button"
                    className="btn-ghost !px-2 !py-1 text-xs"
                    onClick={() => removeVariant(currentVariant.label)}
                  >
                    Remove variant
                  </button>
                ) : null}
              </span>
            ) : null}
          </div>

          <div className="mt-4 grid gap-6 lg:grid-cols-2">
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
              <label className="label mt-4" htmlFor="step-subject">
                Subject{currentVariant ? " (leave empty to reuse variant A's subject)" : ""}
              </label>
              <input
                id="step-subject"
                className="input"
                value={editorSubject}
                disabled={!editable}
                onChange={(e) => updateEditor({ subject: e.target.value })}
                placeholder="Quick question, {{firstName}}"
              />
              <label className="label mt-4" htmlFor="step-body">Body</label>
              <textarea
                id="step-body"
                className="input min-h-44"
                value={editorBody}
                disabled={!editable}
                onChange={(e) => updateEditor({ body: e.target.value })}
                placeholder={"Hi {{firstName|there}},\n\nI noticed {{company}} is hiring SDRs..."}
              />
              {currentVariant ? (
                <>
                  <label className="label mt-4" htmlFor="variant-html">HTML body (optional)</label>
                  <textarea
                    id="variant-html"
                    className="input min-h-20"
                    value={currentVariant.bodyHtml}
                    disabled={!editable}
                    onChange={(e) =>
                      updateVariant(activeStep, currentVariant.label, { bodyHtml: e.target.value })
                    }
                    placeholder="Leave empty to generate HTML from the text body"
                  />
                </>
              ) : null}
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

              {editable ? (
                <div className="mt-6 rounded-lg border border-line p-4">
                  <h3 className="text-sm font-semibold">AI assistance</h3>
                  {aiStatus === null ? (
                    <p className="mt-1 text-xs text-muted">Checking AI configuration...</p>
                  ) : !aiStatus.configured ? (
                    <p className="mt-1 text-xs text-muted">
                      AI is not configured. Set {aiStatus.missingEnv.join(", ") || "OPENAI_API_KEY"} in the
                      server environment to enable subject ideas, rewrites, and icebreakers.
                    </p>
                  ) : (
                    <>
                      <p className="mt-1 text-xs text-muted">
                        AI generated drafts. Review before use; nothing is applied until you click Apply.
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="btn-secondary !py-1.5 text-xs"
                          onClick={fetchSubjectIdeas}
                          disabled={aiBusy !== null}
                        >
                          {aiBusy === "subjects" ? "Thinking..." : "Subject ideas"}
                        </button>
                        {REWRITE_PRESETS.map((preset) => (
                          <button
                            key={preset}
                            type="button"
                            className="btn-secondary !py-1.5 text-xs"
                            onClick={() => fetchRewrite(preset)}
                            disabled={aiBusy !== null || !editorBody.trim()}
                          >
                            {aiBusy === `rewrite:${preset}` ? "Rewriting..." : `Rewrite: ${preset}`}
                          </button>
                        ))}
                      </div>
                      {subjectIdeas ? (
                        <ul className="mt-3 space-y-2">
                          {subjectIdeas.map((idea) => (
                            <li key={idea} className="flex items-center justify-between gap-3 rounded bg-elevated px-3 py-2 text-sm">
                              <span>{idea}</span>
                              <button
                                type="button"
                                className="btn-ghost !px-2 !py-1 text-xs"
                                onClick={() => updateEditor({ subject: idea })}
                              >
                                Apply
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      {rewriteResult !== null ? (
                        <div className="mt-3 rounded bg-elevated px-3 py-2">
                          <pre className="whitespace-pre-wrap font-sans text-sm">{rewriteResult}</pre>
                          <button
                            type="button"
                            className="btn-ghost mt-2 !px-2 !py-1 text-xs"
                            onClick={() => {
                              updateEditor({ body: rewriteResult });
                              setRewriteResult(null);
                            }}
                          >
                            Apply rewrite to variant {activeVariant}
                          </button>
                        </div>
                      ) : null}
                      {aiError ? <p className="mt-2 text-xs text-warning">{aiError}</p> : null}
                    </>
                  )}
                </div>
              ) : null}
            </div>
            <div>
              <h3 className="text-sm font-semibold">
                Live preview, variant {activeVariant}{" "}
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
        </>
      ) : null}
      {notice ? <p className="mt-4 text-sm text-muted">{notice}</p> : null}
    </section>
  );
}
