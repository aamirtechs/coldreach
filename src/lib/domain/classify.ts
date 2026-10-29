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
 *   2. AUTOMATED: a machine receipt, system notice, or support routing
 *      message is not a human decision either. It is checked after
 *      out-of-office so a vacation auto-reply keeps its own label.
 *   3. NEGATIVE: an opt-out or rejection must win over any polite
 *      filler around it ("Thanks, but please remove me" is a no).
 *   4. REFERRAL: "I am not the right person, try Jane" redirects the
 *      conversation rather than answering it.
 *   5. POSITIVE: an explicit expression of interest or a next step.
 *   6. NEUTRAL: the honest default.
 */

export type ReplyClassification =
  | "POSITIVE"
  | "NEGATIVE"
  | "OUT_OF_OFFICE"
  | "REFERRAL"
  | "AUTOMATED"
  | "NEUTRAL";

export const REPLY_CLASSIFICATIONS: ReplyClassification[] = [
  "POSITIVE",
  "NEGATIVE",
  "OUT_OF_OFFICE",
  "REFERRAL",
  "AUTOMATED",
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

// Sender local parts (before the @) that only ever send machine mail.
const AUTOMATED_STRONG_LOCAL_PARTS = [
  "noreply",
  "no-reply",
  "no_reply",
  "donotreply",
  "do-not-reply",
  "mailer-daemon",
  "postmaster",
  "notifications",
  "alerts",
];

// Sender local parts that a human may also reply from. These count
// only when the body carries a machine signal too, so a support agent
// answering in person is not mistaken for a machine.
const AUTOMATED_SUPPORT_LOCAL_PARTS = ["support", "helpdesk", "tickets", "help"];

const AUTOMATED_ACK_PHRASES = [
  "we received your request",
  "we have received your request",
  "your request has been received",
  "a ticket has been created",
  "your ticket has been created",
  "ticket number",
  "case number",
  "reference number",
  "this is an automated",
  "this is an automatic",
  "automated message",
  "automatic notification",
  "do not reply to this",
  "please do not reply",
  "this mailbox is not monitored",
  "unmonitored mailbox",
];

const AUTOMATED_ROUTING_PHRASES = [
  "in-app help",
  "help widget",
  "connect with our team",
  "contact us through",
  "through our help center",
  "use our help center",
  "visit our help center",
  "don't send an email to",
  "do not send an email to",
  "please don't email",
  "chat with our ai assistant",
  "ai assistant",
];

const AUTOMATED_SYSTEM_PHRASES = [
  "delivery status notification",
  "undeliverable",
  "message not delivered",
  "delivery has failed",
];

const AUTOMATED_BODY_PHRASES = [
  ...AUTOMATED_ACK_PHRASES,
  ...AUTOMATED_ROUTING_PHRASES,
  ...AUTOMATED_SYSTEM_PHRASES,
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

/** Local part (before the @) of a sender address, lowercased, or null. */
function senderLocalPart(fromEmail: string | null | undefined): string | null {
  if (!fromEmail) {
    return null;
  }
  // Accept a bare address and a "Name <address>" form alike.
  const bracketed = fromEmail.match(/<([^>]+)>/);
  const address = (bracketed ? bracketed[1] : fromEmail).trim().toLowerCase();
  const at = address.indexOf("@");
  if (at <= 0) {
    return null;
  }
  return address.slice(0, at);
}

/**
 * Detects a machine generated reply: a ticket receipt, a system
 * notice, or a support routing message, rather than a person writing
 * back. A reply counts when it carries either a strong sender signal
 * (a noreply style local part, which qualifies on its own) or at
 * least one automated body signal. Support style local parts such as
 * support@ are ambiguous, since a human agent may answer from them,
 * so they count only when the body also carries a body signal. Body
 * signals are phrases in the body; for non-support senders the
 * subject is checked too, because system notices often put the
 * signal there.
 */
export function isAutomatedReply(
  fromEmail: string | null | undefined,
  subject: string | null | undefined,
  body: string,
): boolean {
  const localPart = senderLocalPart(fromEmail);
  const bodyText = (body ?? "").toLowerCase();
  const hasBodySignal = containsAny(bodyText, AUTOMATED_BODY_PHRASES);

  if (localPart !== null && AUTOMATED_STRONG_LOCAL_PARTS.includes(localPart)) {
    return true;
  }
  if (localPart !== null && AUTOMATED_SUPPORT_LOCAL_PARTS.includes(localPart)) {
    return hasBodySignal;
  }
  const text = `${subject ?? ""}\n${bodyText}`;
  return containsAny(text, AUTOMATED_BODY_PHRASES);
}

/**
 * Classifies a reply from its subject and body. Subject is weighted the
 * same as body: out-of-office responders put the signal in the subject.
 * The optional sender address only feeds the AUTOMATED check.
 */
export function classifyReply(
  subject: string | null | undefined,
  body: string,
  fromEmail?: string | null,
): ReplyClassification {
  const text = `${subject ?? ""}\n${body}`.toLowerCase();

  if (containsAny(text, OUT_OF_OFFICE_PHRASES)) {
    return "OUT_OF_OFFICE";
  }
  if (isAutomatedReply(fromEmail, subject, body)) {
    return "AUTOMATED";
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
