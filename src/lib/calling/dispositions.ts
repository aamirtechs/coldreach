/**
 * Call dispositions for the Calling section (v1.43.0). The CallLog
 * row stores the value string; the label is what the call panel
 * buttons and the tracking table show. The order here is the order
 * the buttons appear in the panel, roughly following a call from
 * "nobody picked up" through to a real outcome.
 */
export const CALL_DISPOSITIONS = [
  { value: "NO_ANSWER", label: "No answer" },
  { value: "VOICEMAIL", label: "Voicemail" },
  { value: "GATEKEEPER", label: "Gatekeeper" },
  { value: "TALKED", label: "Talked" },
  { value: "INTERESTED", label: "Interested" },
  { value: "CALLBACK", label: "Callback" },
  { value: "NOT_INTERESTED", label: "Not interested" },
  { value: "DO_NOT_CALL", label: "Do not call" },
] as const;

export type CallDisposition = (typeof CALL_DISPOSITIONS)[number]["value"];

const DISPOSITION_VALUES = new Set<string>(CALL_DISPOSITIONS.map((d) => d.value));

export function isCallDisposition(value: unknown): value is CallDisposition {
  return typeof value === "string" && DISPOSITION_VALUES.has(value);
}

export function dispositionLabel(value: string): string {
  return CALL_DISPOSITIONS.find((d) => d.value === value)?.label ?? value;
}

/**
 * Dispositions that mean the caller actually spoke with a person at
 * the business, as opposed to a machine or nobody. "Talked" in the
 * tracking stats counts these, so an Interested or a polite Not
 * interested both count as a conversation, while a voicemail does
 * not.
 */
export const CONVERSATION_DISPOSITIONS: ReadonlySet<string> = new Set([
  "TALKED",
  "INTERESTED",
  "CALLBACK",
  "NOT_INTERESTED",
  "DO_NOT_CALL",
]);
