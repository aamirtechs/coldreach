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

export function computeCampaignMetrics(events: MetricEvent[]): CampaignMetrics {
  let sent = 0;
  let delivered = 0;
  let bounced = 0;
  let replies = 0;
  let positiveReplies = 0;
  let unsubscribes = 0;
  let complaints = 0;
  let clicks = 0;
  let opens = 0;

  for (const event of events) {
    switch (event.type) {
      case "SENT":
        sent += 1;
        break;
      case "DELIVERED":
        delivered += 1;
        break;
      case "BOUNCED":
        bounced += 1;
        break;
      case "REPLIED":
        replies += 1;
        if (event.classification?.toUpperCase() === "POSITIVE") {
          positiveReplies += 1;
        }
        break;
      case "UNSUBSCRIBED":
        unsubscribes += 1;
        break;
      case "COMPLAINED":
        complaints += 1;
        break;
      case "CLICKED":
        clicks += 1;
        break;
      case "OPENED":
        opens += 1;
        break;
    }
  }

  return {
    sent,
    delivered,
    bounced,
    replies,
    positiveReplies,
    unsubscribes,
    complaints,
    clicks,
    opens: { count: opens, reliable: false },
    rates: {
      deliveryRate: rate(delivered, sent),
      bounceRate: rate(bounced, sent),
      replyRate: rate(replies, delivered),
      positiveReplyRate: rate(positiveReplies, delivered),
      unsubscribeRate: rate(unsubscribes, delivered),
      complaintRate: rate(complaints, delivered),
    },
  };
}
