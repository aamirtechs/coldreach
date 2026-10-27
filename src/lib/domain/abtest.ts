/**
 * A/B testing for sequence steps.
 *
 * Three pure pieces:
 *
 * 1. pickVariant assigns an enrollment to a variant for one step. The
 *    assignment is a stable hash of (enrollmentId, stepIndex) mapped
 *    into the variants' weight space, so the same enrollment always
 *    sees the same copy for a step across ticks, retries, and worker
 *    restarts, with no assignment table to keep in sync. The base step
 *    copy participates as variant "A"; callers include it in the
 *    candidate list with its weight (currently always 1).
 *
 * 2. variantStats aggregates recorded email events per variant label.
 *    Events recorded before variant tracking carry a null label and
 *    are read as variant "A", the copy that actually sent. The reply
 *    rate denominator is delivered volume, matching the metrics
 *    engine; a variant with no delivered events reports a rate of 0.
 *
 * 3. pickWinner decides whether any variant is demonstrably better.
 *    Method: for the variant with the highest reply rate, run a
 *    two-proportion z-test against every other variant (pooled
 *    standard error, the standard test for comparing two conversion
 *    rates). The leader is declared the winner only when it beats
 *    EVERY other variant at the 95% level (|z| > 1.96, one direction:
 *    the leader's rate must be higher) AND every compared variant has
 *    at least minSample delivered events. Otherwise the result is
 *    null: not enough data, or a difference indistinguishable from
 *    noise. A winner is never declared on a small sample, however
 *    lopsided the rates look, because with few deliveries a lopsided
 *    rate is exactly what noise produces.
 */

export interface VariantCandidate {
  label: string;
  weight: number;
}

export interface VariantEvent {
  type: string;
  variant?: string | null;
}

export interface VariantStat {
  label: string;
  sent: number;
  delivered: number;
  replied: number;
  bounced: number;
  /** replied / delivered (0 when nothing delivered yet). */
  replyRate: number;
}

export interface WinnerResult {
  label: string;
  /** Smallest z-score across the pairwise tests the winner passed. */
  zScore: number;
  /** Largest two-sided p-value across those tests (always < 0.05). */
  pValue: number;
}

/** Default minimum delivered events per variant before a winner test. */
export const DEFAULT_MIN_WINNER_SAMPLE = 30;

const BASE_LABEL = "A";

/** FNV-1a 32-bit hash. Small, fast, and stable across platforms. */
export function hashAssignmentKey(key: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function pickVariant(
  enrollmentId: string,
  stepIndex: number,
  variants: VariantCandidate[],
): string {
  const candidates = variants.filter((variant) => variant.weight > 0);
  if (candidates.length === 0) {
    return BASE_LABEL;
  }
  if (candidates.length === 1) {
    return candidates[0].label;
  }
  const totalWeight = candidates.reduce((sum, variant) => sum + variant.weight, 0);
  const bucket = hashAssignmentKey(`${enrollmentId}:${stepIndex}`) % totalWeight;
  let cumulative = 0;
  for (const candidate of candidates) {
    cumulative += candidate.weight;
    if (bucket < cumulative) {
      return candidate.label;
    }
  }
  return candidates[candidates.length - 1].label;
}

function ensureVariantStat(byLabel: Map<string, VariantStat>, label: string): VariantStat {
  let stat = byLabel.get(label);
  if (!stat) {
    stat = { label, sent: 0, delivered: 0, replied: 0, bounced: 0, replyRate: 0 };
    byLabel.set(label, stat);
  }
  return stat;
}

function addVariantEvent(
  byLabel: Map<string, VariantStat>,
  type: string,
  variant: string | null | undefined,
  count: number,
): void {
  const stat = ensureVariantStat(byLabel, variant ?? BASE_LABEL);
  switch (type) {
    case "SENT":
      stat.sent += count;
      break;
    case "DELIVERED":
      stat.delivered += count;
      break;
    case "REPLIED":
      stat.replied += count;
      break;
    case "BOUNCED":
      stat.bounced += count;
      break;
    default:
      break;
  }
}

function finalizeVariantStats(byLabel: Map<string, VariantStat>): VariantStat[] {
  const stats = [...byLabel.values()];
  for (const stat of stats) {
    stat.replyRate = stat.delivered > 0 ? stat.replied / stat.delivered : 0;
  }
  stats.sort((a, b) => a.label.localeCompare(b.label));
  return stats;
}

export function variantStats(events: VariantEvent[]): VariantStat[] {
  const byLabel = new Map<string, VariantStat>();
  for (const event of events) {
    addVariantEvent(byLabel, event.type, event.variant, 1);
  }
  return finalizeVariantStats(byLabel);
}

/** One aggregated event group, as produced by a database GROUP BY. */
export interface VariantEventCount {
  type: string;
  variant?: string | null;
  count: number;
}

/**
 * variantStats computed from pre-aggregated counts instead of raw
 * event rows, for the same reason as computeCampaignMetricsFromCounts
 * in the metrics engine: high-volume callers aggregate in the
 * database and keep memory flat. Results are identical.
 */
export function variantStatsFromCounts(groups: VariantEventCount[]): VariantStat[] {
  const byLabel = new Map<string, VariantStat>();
  for (const group of groups) {
    addVariantEvent(byLabel, group.type, group.variant, group.count);
  }
  return finalizeVariantStats(byLabel);
}

/** Standard normal CDF, Abramowitz and Stegun 7.1.26 approximation. */
function normalCdf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const abs = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * abs);
  const erf =
    1 -
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-abs * abs);
  return 0.5 * (1 + sign * erf);
}

export interface TwoProportionResult {
  zScore: number;
  /** Two-sided p-value. */
  pValue: number;
}

/** Two-proportion z-test with pooled standard error. */
export function twoProportionZTest(
  successes1: number,
  trials1: number,
  successes2: number,
  trials2: number,
): TwoProportionResult {
  if (trials1 <= 0 || trials2 <= 0) {
    return { zScore: 0, pValue: 1 };
  }
  const p1 = successes1 / trials1;
  const p2 = successes2 / trials2;
  const pooled = (successes1 + successes2) / (trials1 + trials2);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / trials1 + 1 / trials2));
  if (se === 0) {
    return { zScore: 0, pValue: 1 };
  }
  const zScore = (p1 - p2) / se;
  return { zScore, pValue: 2 * (1 - normalCdf(Math.abs(zScore))) };
}

export function pickWinner(
  stats: VariantStat[],
  minSample: number = DEFAULT_MIN_WINNER_SAMPLE,
): WinnerResult | null {
  const contenders = stats.filter((stat) => stat.sent > 0 || stat.delivered > 0);
  if (contenders.length < 2) {
    return null;
  }
  const leader = contenders.reduce((best, stat) =>
    stat.replyRate > best.replyRate ? stat : best,
  );
  if (leader.delivered < minSample) {
    return null;
  }
  let worstZ = Number.POSITIVE_INFINITY;
  let worstP = 0;
  for (const other of contenders) {
    if (other.label === leader.label) {
      continue;
    }
    if (other.delivered < minSample) {
      return null;
    }
    const result = twoProportionZTest(leader.replied, leader.delivered, other.replied, other.delivered);
    if (result.zScore <= 1.96) {
      return null;
    }
    worstZ = Math.min(worstZ, result.zScore);
    worstP = Math.max(worstP, result.pValue);
  }
  return { label: leader.label, zScore: worstZ, pValue: worstP };
}
