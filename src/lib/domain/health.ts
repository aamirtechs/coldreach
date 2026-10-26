/**
 * Sending account health from recorded email events.
 *
 * The formula is deliberately simple and published here and in the UI,
 * so a score can always be traced back to the events behind it:
 *
 *   score = 100
 *     - min(60, bounceRate * 300)        bounces hurt most
 *     - min(30, complaintRate * 3000)    complaints are rare but grave
 *     - min(20, failedRate * 100)        provider failures
 *
 * Rates use SENT events as the denominator. With no sends recorded the
 * score is null: the account has no track record yet, and inventing one
 * would be fake data. Benchmarks for orientation: a bounce rate above
 * 2 percent or a complaint rate above 0.1 percent is where mainstream
 * providers start restricting senders, which is what the weights encode.
 */

export interface AccountEventCounts {
  sent: number;
  bounced: number;
  complained: number;
  failed: number;
  delivered: number;
}

export interface AccountHealth {
  score: number | null;
  grade: "A" | "B" | "C" | "D" | "F" | null;
  bounceRate: number;
  complaintRate: number;
  failedRate: number;
}

export function computeAccountHealth(counts: AccountEventCounts): AccountHealth {
  if (counts.sent <= 0) {
    return { score: null, grade: null, bounceRate: 0, complaintRate: 0, failedRate: 0 };
  }
  const bounceRate = counts.bounced / counts.sent;
  const complaintRate = counts.complained / counts.sent;
  const failedRate = counts.failed / counts.sent;
  const penalty =
    Math.min(60, bounceRate * 300) +
    Math.min(30, complaintRate * 3000) +
    Math.min(20, failedRate * 100);
  const score = Math.max(0, Math.round(100 - penalty));
  const grade = score >= 90 ? "A" : score >= 75 ? "B" : score >= 55 ? "C" : score >= 35 ? "D" : "F";
  return { score, grade, bounceRate, complaintRate, failedRate };
}
