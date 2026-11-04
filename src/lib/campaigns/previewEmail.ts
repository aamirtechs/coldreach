import { pickVariant } from "@/lib/domain/abtest";
import { renderTemplate, senderIdentityFields, type LeadFields } from "@/lib/domain/personalize";
import { renderSpintax } from "@/lib/domain/spintax";

/**
 * The one place a campaign email's copy is rendered (v1.16.0).
 *
 * The sending worker (sendTick) and the dashboard's Upcoming sends
 * preview both render through this function, so the preview is not
 * an approximation of the email: it is the same subject, body,
 * signature, and compliance footer the worker will send for that
 * enrollment and step, produced by the same code with the same
 * inputs. Variant choice and spintax are deterministic per
 * enrollment and step, so a preview rendered now matches the send
 * rendered later, unless the sequence, signature, or lead fields are
 * edited in between.
 *
 * HTML rendering, link rewriting, and the open-tracking pixel stay
 * in the worker: they depend on the sending account and tracking
 * host chosen at send time. The preview shows the plain-text part,
 * which carries the full copy every recipient can read.
 */

export interface EmailCopyVariant {
  label: string;
  subject?: string | null;
  bodyText: string;
  bodyHtml?: string | null;
  weight: number;
}

export interface EmailCopyStep {
  subject: string;
  body: string;
  variants: EmailCopyVariant[];
}

export interface RenderedEmailCopy {
  /** A/B variant label the copy belongs to ("A" is the step itself). */
  variantLabel: string;
  variant: EmailCopyVariant | null;
  subject: string;
  bodyText: string;
  /** Signature block placed between the body and the footer, if any. */
  effectiveSignature: string;
  footerText: string;
  /** The complete plain-text email: body, signature, footer. */
  fullText: string;
  /** Lead fields plus sender identity, for the worker's HTML render. */
  renderFields: LeadFields;
  /** Deterministic spintax seed for this enrollment and step. */
  spintaxSeed: string;
  /** Sender name line for the footer (empty when a signature signs off). */
  footerSenderLines: string[];
}

export function renderEmailCopy(input: {
  enrollmentId: string;
  stepIndex: number;
  step: EmailCopyStep;
  leadEmail: string;
  leadFields: LeadFields;
  campaign: {
    signatureText?: string | null;
    senderName?: string | null;
    companyName?: string | null;
  };
  workspace: {
    senderName?: string | null;
    name: string;
    senderAddress?: string | null;
  };
  unsubscribeUrl: string;
}): RenderedEmailCopy {
  const { step, stepIndex } = input;
  // A/B variant: deterministic per enrollment and step, so a retry
  // after a provider failure (and a preview) renders identical copy.
  // Variant A is the step's own subject and body.
  const variantLabel = pickVariant(input.enrollmentId, stepIndex, [
    { label: "A", weight: 1 },
    ...step.variants.map((variant) => ({ label: variant.label, weight: variant.weight })),
  ]);
  const variant = step.variants.find((entry) => entry.label === variantLabel) ?? null;

  // Sender identity tokens: {{senderName}}, {{senderCompany}}, and
  // {{senderFirstName}} resolve from the campaign identity with
  // workspace fallbacks. Identity values win over same-named lead
  // fields.
  const renderFields: LeadFields = {
    ...input.leadFields,
    email: input.leadEmail,
    ...senderIdentityFields({
      campaignSenderName: input.campaign.senderName,
      campaignCompanyName: input.campaign.companyName,
      workspaceSenderName: input.workspace.senderName,
      workspaceName: input.workspace.name,
    }),
  };
  // Spintax: after template rendering, resolve any {a|b|c} groups.
  // The seed is the enrollment and step, so a retry of this send
  // renders the identical text while different leads get different
  // ones. Copy without spintax passes through unchanged.
  const spintaxSeed = `${input.enrollmentId}:${stepIndex}`;
  const subject = renderSpintax(
    renderTemplate(variant?.subject ?? step.subject, renderFields),
    spintaxSeed,
  );
  const bodyText = renderSpintax(
    renderTemplate(variant ? variant.bodyText : step.body, renderFields),
    spintaxSeed,
  );
  const senderLine = input.workspace.senderName ?? input.workspace.name;
  // Per-campaign signature: rendered with the same lead fields and
  // placed between the body and the compliance footer.
  const signatureText = input.campaign.signatureText
    ? renderTemplate(input.campaign.signatureText, renderFields).trim()
    : "";
  // Per-campaign sender identity: when the campaign has no signature
  // of its own, its senderName and companyName compose the sign-off
  // block. An explicit signature always wins.
  const identitySignature = signatureText
    ? ""
    : [input.campaign.senderName?.trim(), input.campaign.companyName?.trim()]
        .filter((line): line is string => Boolean(line))
        .join("\n");
  const effectiveSignature = signatureText || identitySignature;
  // Footer slimming: when the campaign carries its own signature, the
  // signature already signs off with the sender's name, so the
  // compliance footer drops the repeated name line and keeps only
  // the postal address and the unsubscribe link.
  const footerSenderLines = effectiveSignature ? [] : [senderLine];
  const footerText = [
    "",
    "--",
    ...footerSenderLines,
    ...(input.workspace.senderAddress ? [input.workspace.senderAddress] : []),
    `Unsubscribe: ${input.unsubscribeUrl}`,
  ].join("\n");
  const fullText = effectiveSignature
    ? `${bodyText}\n\n${effectiveSignature}\n${footerText}`
    : `${bodyText}\n${footerText}`;
  return {
    variantLabel,
    variant,
    subject,
    bodyText,
    effectiveSignature,
    footerText,
    fullText,
    renderFields,
    spintaxSeed,
    footerSenderLines,
  };
}
