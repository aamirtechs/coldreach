/**
 * State priority for calling leads (user instruction, 2026-11-21).
 * This module is the single source of truth: the UI, the API sort
 * and the future daily lead pipeline all read the same data.
 *
 * Order: Georgia first, then Illinois, then North Carolina, then
 * Ohio. Calling leads may only exist for these four states
 * (user instruction, 2026-11-21, final): anything outside them is
 * not added at all. Texas joins the list only after telemarketer
 * registration there is done. Florida, Oklahoma, Maryland,
 * Washington and Connecticut are excluded (legal risk states).
 * The HELD and BLOCKED classifications stay for defence in depth:
 * if an out of state lead ever appears through a manual add or an
 * import, it is badged and bannered as do not call, and it sinks
 * to the bottom of every list.
 */

export const STATE_PRIORITY: { state: string; rank: number }[] = [
  { state: "GA", rank: 1 },
  { state: "IL", rank: 2 },
  { state: "NC", rank: 3 },
  { state: "OH", rank: 4 },
];

export const HELD_STATES: Record<string, string> = {
  TX: "Held: Texas telemarketer registration pending",
};

export const BLOCKED_STATES: string[] = ["FL", "OK", "MD", "WA", "CT"];

export const BLOCKED_STATE_NOTE =
  "Held: legal risk state per the 2026-11-21 state research, do not call until the user reviews";

export type StateStatus = "PRIORITY" | "STANDARD" | "HELD" | "BLOCKED";

export function normalizeState(state: string | null | undefined): string {
  return (state ?? "").trim().toUpperCase();
}

export function stateStatus(state: string | null | undefined): StateStatus {
  const normalized = normalizeState(state);
  if (STATE_PRIORITY.some((entry) => entry.state === normalized)) return "PRIORITY";
  if (normalized in HELD_STATES) return "HELD";
  if (BLOCKED_STATES.includes(normalized)) return "BLOCKED";
  return "STANDARD";
}

export function isCallableState(state: string | null | undefined): boolean {
  const status = stateStatus(state);
  return status === "PRIORITY" || status === "STANDARD";
}

/** Lower sorts first. Priority states keep their 1 to 4 order. */
export function stateRank(state: string | null | undefined): number {
  const normalized = normalizeState(state);
  const priority = STATE_PRIORITY.find((entry) => entry.state === normalized);
  if (priority) return priority.rank;
  const status = stateStatus(normalized);
  if (status === "STANDARD") return 10;
  if (status === "HELD") return 20;
  return 30;
}

export interface SortableCallLead {
  state?: string | null;
  temperature?: string | null;
  leadScore?: number | null;
}

/**
 * Default call lead order: state priority first (Georgia at the
 * top), then temperature (HOT before WARM), then leadScore
 * descending. Held and blocked states fall to the bottom through
 * their rank.
 */
export function compareCallLeads(a: SortableCallLead, b: SortableCallLead): number {
  const byState = stateRank(a.state) - stateRank(b.state);
  if (byState !== 0) return byState;
  const tempRank = (temperature: string | null | undefined) =>
    temperature === "HOT" ? 0 : 1;
  const byTemp = tempRank(a.temperature) - tempRank(b.temperature);
  if (byTemp !== 0) return byTemp;
  return (b.leadScore ?? -1) - (a.leadScore ?? -1);
}

export function sortCallLeads<T extends SortableCallLead>(leads: T[]): T[] {
  return [...leads].sort(compareCallLeads);
}
