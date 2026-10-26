/**
 * Campaign preflight.
 *
 * ColdReach's launch gate. Before a campaign may send, preflight checks
 * the sequence content, the enrolled audience, the sending capacity, the
 * template tokens against the fields leads actually carry, and the
 * compliance basics (a working unsubscribe mechanism and a complete
 * sender identity). FAIL checks block launch outright. WARN checks are
 * surfaced for a human decision but do not block.
 *
 * This module is pure: the server assembles the inputs from the database
 * and this function renders the verdict.
 */

import { findUnknownTokens } from "./personalize";

export type PreflightStatus = "pass" | "warn" | "fail";

export interface PreflightCheck {
  id: string;
  label: string;
  status: PreflightStatus;
  message: string;
}

export interface PreflightStep {
  subject: string;
  body: string;
}

export interface PreflightAccount {
  id: string;
  email: string;
  /** Status string from the sending account record, for example CONNECTED. */
  status: string;
  /** Effective daily limit after the ramp, from the limits engine. */
  effectiveDailyLimit: number;
}

export interface PreflightInput {
  steps: PreflightStep[];
  /** Leads enrolled and ACTIVE in the campaign. */
  enrolledCount: number;
  /** Enrolled leads currently matching a suppression entry. Should be
   *  zero because enrollment filters suppressions, so any value above
   *  zero means a suppression landed after enrollment. */
  suppressedEnrolledCount: number;
  accounts: PreflightAccount[];
  /** Field names available for personalisation: the union of keys across
   *  enrolled leads' field records, plus built-ins such as email. */
  availableFields: string[];
  /** True when every message will carry a working unsubscribe link and a
   *  compliant footer. In ColdReach the worker always appends both, so
   *  the server passes false only when the footer cannot be completed,
   *  which today means the workspace postal address is missing. */
  unsubscribeConfigured: boolean;
  senderIdentity: {
    displayName: string | null;
    postalAddress: string | null;
  };
  /** Estimated sends on the busiest day, compared with total account
   *  capacity. Enrollment schedules every lead for step one, so the
   *  server passes the enrolled count as the first day estimate. */
  projectedDailyVolume: number;
  /** Plan quota context (Phase 4). Optional so older callers and tests
   *  keep working; when present, a campaign whose projected total
   *  sends would exceed the month's remaining quota fails preflight. */
  quota?: {
    planName: string;
    monthlyLimit: number;
    sentThisMonth: number;
    /** Sends this campaign would produce if its sequence ran to
     *  completion for every enrolled lead. */
    projectedTotalSends: number;
  };
}

export interface PreflightResult {
  status: PreflightStatus;
  canLaunch: boolean;
  checks: PreflightCheck[];
}

export function runPreflight(input: PreflightInput): PreflightResult {
  const checks: PreflightCheck[] = [];
  const add = (id: string, label: string, status: PreflightStatus, message: string) => {
    checks.push({ id, label, status, message });
  };

  // Sequence content -------------------------------------------------------
  if (input.steps.length === 0) {
    add("steps", "Sequence steps", "fail", "The campaign has no steps. Add at least one email step before launch.");
  } else {
    const emptyBodies = input.steps
      .map((step, index) => (step.body.trim() === "" ? index + 1 : null))
      .filter((n): n is number => n !== null);
    if (emptyBodies.length > 0) {
      add(
        "steps",
        "Sequence steps",
        "fail",
        `Step ${emptyBodies.join(", ")} ${emptyBodies.length === 1 ? "has" : "have"} an empty body. Every step needs content before launch.`,
      );
    } else {
      add("steps", "Sequence steps", "pass", `${input.steps.length} step${input.steps.length === 1 ? "" : "s"} with content.`);
    }
    const emptySubjects = input.steps
      .map((step, index) => (step.subject.trim() === "" ? index + 1 : null))
      .filter((n): n is number => n !== null);
    if (emptySubjects.length > 0) {
      add(
        "subjects",
        "Step subjects",
        "warn",
        `Step ${emptySubjects.join(", ")} ${emptySubjects.length === 1 ? "has" : "have"} an empty subject. Follow-ups can thread onto the previous subject, but a subjectless first step usually performs badly.`,
      );
    }
  }

  // Audience ---------------------------------------------------------------
  if (input.enrolledCount === 0) {
    add("audience", "Enrolled leads", "fail", "No leads are enrolled. Attach a lead list and run enrollment before launch.");
  } else {
    add("audience", "Enrolled leads", "pass", `${input.enrolledCount} lead${input.enrolledCount === 1 ? "" : "s"} enrolled.`);
  }

  if (input.suppressedEnrolledCount > 0) {
    add(
      "suppressed",
      "Suppressed enrollees",
      "warn",
      `${input.suppressedEnrolledCount} enrolled lead${input.suppressedEnrolledCount === 1 ? " is" : "s are"} now suppressed. The worker will skip and close those enrollments, but review the suppression list before launch.`,
    );
  } else if (input.enrolledCount > 0) {
    add("suppressed", "Suppressed enrollees", "pass", "No enrolled lead matches a suppression entry.");
  }

  // Sending capacity ---------------------------------------------------------
  if (input.accounts.length === 0) {
    add("accounts", "Sending accounts", "fail", "No sending account is attached to this campaign.");
  } else {
    const usable = input.accounts.filter((a) => a.status === "CONNECTED");
    if (usable.length === 0) {
      add(
        "accounts",
        "Sending accounts",
        "fail",
        "Accounts are attached but none is in CONNECTED status, so nothing can send.",
      );
    } else {
      add(
        "accounts",
        "Sending accounts",
        "pass",
        `${usable.length} connected account${usable.length === 1 ? "" : "s"} attached.`,
      );
    }
    const totalCapacity = input.accounts.reduce((sum, a) => sum + a.effectiveDailyLimit, 0);
    if (usable.length > 0 && input.projectedDailyVolume > totalCapacity) {
      add(
        "capacity",
        "Daily volume vs capacity",
        "warn",
        `Projected volume of ${input.projectedDailyVolume} sends on the first day exceeds the combined effective daily limit of ${totalCapacity}. Sends will spread across more days than the sequence delays suggest.`,
      );
    } else if (usable.length > 0) {
      add(
        "capacity",
        "Daily volume vs capacity",
        "pass",
        `Projected first day volume fits within the combined effective daily limit of ${totalCapacity}.`,
      );
    }
  }

  // Personalisation tokens ---------------------------------------------------
  if (input.steps.length > 0) {
    const available: Record<string, string> = {};
    for (const fieldName of input.availableFields) {
      available[fieldName] = "value";
    }
    const unknown = new Set<string>();
    for (const step of input.steps) {
      for (const token of findUnknownTokens(step.subject, available)) {
        unknown.add(token);
      }
      for (const token of findUnknownTokens(step.body, available)) {
        unknown.add(token);
      }
    }
    if (unknown.size > 0) {
      add(
        "tokens",
        "Personalisation tokens",
        "fail",
        `These tokens have no matching lead field and no fallback: ${[...unknown].map((t) => `{{${t}}}`).join(", ")}. Add the field to your leads or give the token a fallback like {{${[...unknown][0]}|there}}.`,
      );
    } else {
      add("tokens", "Personalisation tokens", "pass", "Every token resolves from a lead field or a fallback.");
    }
  }

  // Compliance -----------------------------------------------------------------
  if (!input.unsubscribeConfigured) {
    add(
      "unsubscribe",
      "Unsubscribe mechanism",
      "fail",
      "The compliance footer cannot be completed because the workspace postal address is missing. Add it in workspace settings before launch.",
    );
  } else {
    add(
      "unsubscribe",
      "Unsubscribe mechanism",
      "pass",
      "Every message carries an unsubscribe link and the sender postal address.",
    );
  }

  const missingIdentity: string[] = [];
  if (!input.senderIdentity.displayName) {
    missingIdentity.push("sender display name");
  }
  if (!input.senderIdentity.postalAddress) {
    missingIdentity.push("postal address");
  }
  if (missingIdentity.length > 0) {
    add(
      "identity",
      "Sender identity",
      "warn",
      `Workspace sender identity is incomplete: missing ${missingIdentity.join(" and ")}. Messages will use the workspace name, and some jurisdictions require a full postal address in the footer.`,
    );
  } else {
    add("identity", "Sender identity", "pass", "Sender display name and postal address are set.");
  }

  // Plan quota -------------------------------------------------------------
  if (input.quota) {
    const { planName, monthlyLimit, sentThisMonth, projectedTotalSends } = input.quota;
    const remaining = Math.max(0, monthlyLimit - sentThisMonth);
    if (sentThisMonth + projectedTotalSends > monthlyLimit) {
      add(
        "quota",
        "Plan send quota",
        "fail",
        `This campaign would send up to ${projectedTotalSends} messages across its sequence, but the ${planName} plan has ${remaining} of ${monthlyLimit} monthly sends remaining (${sentThisMonth} already sent this month). Reduce the audience or sequence, or upgrade the plan in Billing.`,
      );
    } else {
      add(
        "quota",
        "Plan send quota",
        "pass",
        `${remaining} of ${monthlyLimit} monthly sends remain on the ${planName} plan; this campaign projects ${projectedTotalSends}.`,
      );
    }
  }

  const hasFail = checks.some((c) => c.status === "fail");
  const hasWarn = checks.some((c) => c.status === "warn");
  return {
    status: hasFail ? "fail" : hasWarn ? "warn" : "pass",
    canLaunch: !hasFail,
    checks,
  };
}
