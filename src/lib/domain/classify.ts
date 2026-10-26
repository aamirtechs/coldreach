/**
 * Reply classification by explicit keyword and phrase rules.
 *
 * This is a transparent rules engine, not AI and not a model: every
 * outcome can be traced to a phrase in the lists below, members can
 * override any result in the inbox, and the lists are deliberately
 * conservative. A reply is only POSITIVE or NEGATIVE when it carries a
 * phrase a human would read the same way; everything else is NEUTRAL.
 *
 * Rule order matters and is intentional:
 *   1. OUT_OF_OFFICE: an auto-reply is not a human decision, even when
 *      it happens to mention interest or other keywords.
 *   2. NEGATIVE: an opt-out or rejection must win over any polite
 *      filler around it ("Thanks, but please remove me" is a no).
 *   3. REFERRAL: "I am not the right person, try Jane" redirects the
 *      conversation rather than answering it.
 *   4. POSITIVE: an explicit expression of interest or a next step.
 *   5. NEUTRAL: the honest default.
 */

export type ReplyClassification =
  | "POSITIVE"
  | "NEGATIVE"
  | "OUT_OF_OFFICE"
  | "REFERRAL"
  | "NEUTRAL";

export const REPLY_CLASSIFICATIONS: ReplyClassification[] = [
  "POSITIVE",
  "NEGATIVE",
  "OUT_OF_OFFICE",
  "REFERRAL",
  "NEUTRAL",
];

const OUT_OF_OFFICE_PHRASES = [
  "out of office",
  "out-of-office",
  "currently out of the office",
  "on vacation",
  "on annual leave",
  "on leave until",
  "on parental leave",
  "on maternity leave",
  "on paternity leave",
  "away from the office",
  "limited access to email",
  "limited access to my email",
  "i will be back on",
  "i'll be back on",
  "returning on",
  "automatic reply",
  "auto-reply",
  "autoreply",
  "this is an automated response",
  "do not reply to this email",
];

const NEGATIVE_PHRASES = [
  "unsubscribe",
  "remove me",
  "remove my email",
  "remove my address",
  "take me off",
  "opt out",
  "opt-out",
  "not interested",
  "no thanks",
  "no thank you",
  "not a fit",
  "not relevant",
  "stop emailing",
  "stop sending",
  "please stop",
  "do not contact",
  "don't contact me",
  "do not email",
  "don't email me",
  "leave me alone",
  "marking as spam",
  "report as spam",
  "this is spam",
  "never contact",
  "we are not looking",
  "we're not looking",
  "no budget",
  "already have a vendor",
  "already use a competitor",
  "happy with our current",
];

const REFERRAL_PHRASES = [
  "not the right person",
  "i'm not the right person",
  "i am not the right person",
  "wrong person",
  "you should talk to",
  "you should speak to",
  "talk to our",
  "speak with our",
  "reach out to",
  "contact our",
  "the right person is",
  "best person to contact",
  "looped in",
  "looping in",
  "i've forwarded",
  "i have forwarded",
  "forwarded your email",
  "cc'd",
  "ccing",
  "adding our",
  "no longer at the company",
  "no longer works here",
  "has left the company",
  "left the company",
];

const POSITIVE_PHRASES = [
  "interested",
  "sounds good",
  "sounds interesting",
  "let's talk",
  "lets talk",
  "let's chat",
  "let's set up",
  "book a call",
  "book a meeting",
  "schedule a call",
  "schedule a meeting",
  "set up a call",
  "set up a demo",
  "happy to chat",
  "happy to talk",
  "happy to have a call",
  "send me more",
  "more information",
  "more info",
  "send over details",
  "send me details",
  "what are your prices",
  "what is your pricing",
  "how much does it cost",
  "pricing look like",
  "next steps",
  "works for me",
  "that time works",
  "looking forward to it",
  "yes, please",
  "yes please",
  "count me in",
  "sign me up",
  "great fit",
  "good fit",
  "exactly what we need",
  "tell me more",
];

function containsAny(haystack: string, phrases: string[]): boolean {
  return phrases.some((phrase) => haystack.includes(phrase));
}

/**
 * Classifies a reply from its subject and body. Subject is weighted the
 * same as body: out-of-office responders put the signal in the subject.
 */
export function classifyReply(subject: string | null | undefined, body: string): ReplyClassification {
  const text = `${subject ?? ""}\n${body}`.toLowerCase();

  if (containsAny(text, OUT_OF_OFFICE_PHRASES)) {
    return "OUT_OF_OFFICE";
  }
  if (containsAny(text, NEGATIVE_PHRASES)) {
    return "NEGATIVE";
  }
  if (containsAny(text, REFERRAL_PHRASES)) {
    return "REFERRAL";
  }
  // A bare "interested" surrounded by a negation is NEGATIVE territory,
  // but the negative list above has already had its chance; a remaining
  // "not interested" would have matched there.
  if (containsAny(text, POSITIVE_PHRASES)) {
    return "POSITIVE";
  }
  return "NEUTRAL";
}

export function isReplyClassification(value: string): value is ReplyClassification {
  return (REPLY_CLASSIFICATIONS as string[]).includes(value);
}
