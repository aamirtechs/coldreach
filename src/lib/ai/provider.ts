/**
 * AI assistance contract.
 *
 * Every AI feature goes through this interface, the same way every
 * send goes through MailProvider. Implementations must follow the
 * product's content rules, which are part of the prompts themselves:
 * no deceptive content (no fake familiarity, no invented facts about
 * the recipient or their company), no spam-filter evasion tricks,
 * and no promises the sender cannot keep. Output is a draft for a
 * human: the UI inserts it only when the user clicks Apply, and the
 * docs disclose that the text is AI generated and must be reviewed.
 */

export interface SubjectContext {
  campaignName?: string;
  /** The step's current subject, if one exists. */
  currentSubject?: string;
  /** The step's body, so suggestions match the actual pitch. */
  body?: string;
  count?: number;
}

export type RewriteInstruction = "shorter" | "more direct" | "friendlier";

export const REWRITE_INSTRUCTIONS: RewriteInstruction[] = ["shorter", "more direct", "friendlier"];

export interface IcebreakerContext {
  leadFields: Record<string, string>;
  leadEmail: string;
  campaignName?: string;
  campaignContext?: string;
}

export interface AiProvider {
  readonly id: string;
  suggestSubjects(context: SubjectContext): Promise<string[]>;
  rewriteBody(body: string, instruction: RewriteInstruction): Promise<string>;
  icebreaker(context: IcebreakerContext): Promise<string>;
}

export const AI_CONTENT_RULES = [
  "You write cold outreach email copy for a human sales rep.",
  "Never invent facts about the recipient, their company, or the sender.",
  "Never suggest a prior relationship, meeting, or referral that did not happen.",
  "Never use tricks to evade spam filters: no obfuscated words, no misleading subject lines, no fake reply or forward markers.",
  "Keep every claim verifiable and every promise one the sender can keep.",
].join(" ");
