/**
 * Campaign metrics.
 *
 * Metrics are computed from recorded email events only. Nothing here
 * estimates or invents numbers. Rates are computed on delivered volume
 * where that is the meaningful denominator; delivery and bounce rates
 * use sent volume. Opens are reported separately and flagged unreliable,
 * because privacy protection features in modern mail clients both
 * prefetch tracking pixels (inflating opens) and block them entirely.
 */

export type EmailEventTypeValue =
  | "SENT"
  | "DELIVERED"
  | "OPENED"
  | "CLICKED"
  | "REPLIED"
  | "BOUNCED"
  | "UNSUBSCRIBED"
  | "COMPLAINED";

export interface MetricEvent {
  type: EmailEventTypeValue;
  /** Optional reply classification, for example "POSITIVE". */
  classification?: string | null;
}

export interface CampaignMetrics {
  sent: number;
  delivered: number;
  bounced: number;
  replies: number;
  /** REPLIED events classified AUTOMATED (v1.11.0): machine replies
   *  such as ticket receipts and support routing notices. Kept out
   *  of `replies` so reply figures mean human replies. */
  automatedReplies: number;
  positiveReplies: number;
  unsubscribes: number;
  complaints: number;
  clicks: number;
  opens: {
    count: number;
    /** Opens are always reported as unreliable. See the module notes. */
    reliable: false;
  };
  rates: {
    /** delivered / sent */
    deliveryRate: number;
    /** bounced / sent */
    bounceRate: number;
    /** replies / delivered */
    replyRate: number;
    /** clicks / delivered */
    clickRate: number;
    /** positiveReplies / delivered */
    positiveReplyRate: number;
    /** unsubscribes / delivered */
    unsubscribeRate: number;
    /** complaints / delivered */
    complaintRate: number;
  };
}

function rate(numerator: number, denominator: number): number {
  if (denominator <= 0) {
    return 0;
  }
  return numerator / denominator;
}

interface Tallies {
  sent: number;
  delivered: number;
  bounced: number;
  replies: number;
  automatedReplies: number;
  positiveReplies: number;
  unsubscribes: number;
  complaints: number;
  clicks: number;
  opens: number;
}

function emptyTallies(): Tallies {
  return {
    sent: 0,
    delivered: 0,
    bounced: 0,
    replies: 0,
    automatedReplies: 0,
    positiveReplies: 0,
    unsubscribes: 0,
    complaints: 0,
    clicks: 0,
    opens: 0,
  };
}

function addToTallies(
  tallies: Tallies,
  type: string,
  classification: string | null | undefined,
  count: number,
): void {
  switch (type) {
    case "SENT":
      tallies.sent += count;
      break;
    case "DELIVERED":
      tallies.delivered += count;
      break;
    case "BOUNCED":
      tallies.bounced += count;
      break;
    case "REPLIED":
      if (classification?.toUpperCase() === "AUTOMATED") {
        tallies.automatedReplies += count;
        break;
      }
      tallies.replies += count;
      if (classification?.toUpperCase() === "POSITIVE") {
        tallies.positiveReplies += count;
      }
      break;
    case "UNSUBSCRIBED":
      tallies.unsubscribes += count;
      break;
    case "COMPLAINED":
      tallies.complaints += count;
      break;
    case "CLICKED":
      tallies.clicks += count;
      break;
    case "OPENED":
      tallies.opens += count;
      break;
    default:
      break;
  }
}

function finalizeTallies(t: Tallies): CampaignMetrics {
  return {
    sent: t.sent,
    delivered: t.delivered,
    bounced: t.bounced,
    replies: t.replies,
    automatedReplies: t.automatedReplies,
    positiveReplies: t.positiveReplies,
    unsubscribes: t.unsubscribes,
    complaints: t.complaints,
    clicks: t.clicks,
    opens: { count: t.opens, reliable: false },
    rates: {
      deliveryRate: rate(t.delivered, t.sent),
      bounceRate: rate(t.bounced, t.sent),
      replyRate: rate(t.replies, t.delivered),
      clickRate: rate(t.clicks, t.delivered),
      positiveReplyRate: rate(t.positiveReplies, t.delivered),
      unsubscribeRate: rate(t.unsubscribes, t.delivered),
      complaintRate: rate(t.complaints, t.delivered),
    },
  };
}

export function computeCampaignMetrics(events: MetricEvent[]): CampaignMetrics {
  const tallies = emptyTallies();
  for (const event of events) {
    addToTallies(tallies, event.type, event.classification, 1);
  }
  return finalizeTallies(tallies);
}

/** One aggregated event group, as produced by a database GROUP BY. */
export interface MetricEventCount {
  type: string;
  classification?: string | null;
  count: number;
}

/**
 * The same metrics computed from pre-aggregated counts instead of
 * raw event rows. Callers with large event volumes (the analytics
 * page and the stats API routes) aggregate in the database with
 * groupBy and pass the handful of resulting groups here, so memory
 * stays flat no matter how many events a campaign has recorded.
 * Results are identical to computeCampaignMetrics on the same data.
 */
export function computeCampaignMetricsFromCounts(groups: MetricEventCount[]): CampaignMetrics {
  const tallies = emptyTallies();
  for (const group of groups) {
    addToTallies(tallies, group.type, group.classification, group.count);
  }
  return finalizeTallies(tallies);
}
