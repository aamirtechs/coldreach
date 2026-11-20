/**
 * Name pronunciation helpers for the call panel (v1.45.0). The
 * respelling itself is data, typed by a human into the lead's
 * namePronunciation field (for example "LEN-erd duh-ZEER"); these
 * pure functions only build the exact text the browser's built in
 * speech synthesis will speak, so they can be unit tested without
 * a browser. Speech itself happens in the component through
 * window.speechSynthesis, which is free and built into Chrome.
 */

/** How fast the spoken name plays: slower than normal speech. */
export const NAME_SPEECH_RATE = 0.85;

/**
 * The name to speak when the caller taps Listen: the decision
 * maker's name only, with any role note in brackets stripped
 * ("Leonard Desir (lawyer)" becomes "Leonard Desir") and extra
 * whitespace collapsed. Returns "" when there is no name.
 */
export function nameUtteranceText(name: string | null | undefined): string {
  if (!name) return "";
  return name.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * The greeting line the caller actually opens with, so he can
 * hear the first name inside the sentence: "Hi, is that Anna?"
 * Returns "" when there is no first name to greet.
 */
export function greetingUtteranceText(firstName: string | null | undefined): string {
  const name = nameUtteranceText(firstName);
  return name ? `Hi, is that ${name}?` : "";
}

/**
 * The spoken name for a lead: its first and last name fields when
 * both are recorded, otherwise the decision maker text. Field
 * values arrive as unknown JSON, so only real strings count.
 */
export function spokenNameForFields(fields: Record<string, unknown> | unknown): string {
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) return "";
  const record = fields as Record<string, unknown>;
  const text = (key: string) => (typeof record[key] === "string" ? (record[key] as string) : "");
  const first = text("firstName").trim();
  const last = text("lastName").trim();
  if (first && last) return nameUtteranceText(`${first} ${last}`);
  return nameUtteranceText(text("decisionMaker"));
}

/** The first name to greet with: the lead's firstName field. */
export function greetingNameForFields(fields: Record<string, unknown> | unknown): string {
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) return "";
  const record = fields as Record<string, unknown>;
  return typeof record.firstName === "string" ? record.firstName : "";
}

/** The minimal voice shape the picker reads; matches SpeechSynthesisVoice. */
export interface VoiceLike {
  lang: string;
  name: string;
  default?: boolean;
}

/**
 * Picks the voice to speak a name with: an en-US voice when one
 * is available (a Google US English voice first when Chrome
 * offers it), then any English voice, then the browser default.
 * Returns null when the list is empty, and the caller just sets
 * lang "en-US" on the utterance instead.
 */
export function pickEnUsVoice<T extends VoiceLike>(voices: readonly T[]): T | null {
  if (voices.length === 0) return null;
  const langOf = (voice: T) => voice.lang.replace("_", "-").toLowerCase();
  const us = voices.filter((voice) => langOf(voice) === "en-us");
  if (us.length > 0) {
    return us.find((voice) => /google/i.test(voice.name)) ?? us[0];
  }
  const english = voices.find((voice) => langOf(voice).startsWith("en"));
  if (english) return english;
  return voices.find((voice) => voice.default) ?? null;
}
