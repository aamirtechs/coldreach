/**
 * The guided call flow for the Calling section (v1.46.0). The flow
 * is data, not code: an ordered list of nodes, each with the exact
 * words to say, an optional delivery hint that is never spoken, and
 * the responses the prospect might give, each pointing at the next
 * node. Terminal nodes carry the disposition the call panel should
 * suggest when the call ends there.
 *
 * Content is adapted from the expert-backed script research pack of
 * 2026-11-20 (permission opener, gatekeeper and voicemail scripts,
 * Josh Braun style email objection reply, agree and isolate for
 * "not interested"), branched so one card shows at a time and every
 * answer has a written next step. Say text uses the script
 * renderer's tokens and fills from the selected lead at call time.
 *
 * Some nodes carry two variants. The plain `say` and `responses`
 * are for speed leads, the ones with a measured mobileScore and
 * LCP on their fields. `sayGeneric` and `responsesGeneric` are for
 * leads without a score, where the pitch is the specific problem
 * on the lead's hook and pain points and the offer is a free
 * review instead of a priced fix. resolveFlowNode picks the pair.
 *
 * No node ever promises a 100 score or a search ranking. The only
 * guarantee language is the measured improvement line, which is
 * the caller's real policy, and the Google three second figure is
 * always attributed to Google's research, never turned into a
 * claim about the prospect's own losses.
 */
import { isCallDisposition, type CallDisposition } from "./dispositions";
import {
  renderScriptTemplate,
  scriptValuesForLead,
  type ScriptLeadContext,
} from "./renderScript";

export interface CallFlowResponse {
  label: string;
  next: string;
}

export interface CallFlowNode {
  id: string;
  stage: string;
  title: string;
  /** Words to say, speed variant (lead has a mobileScore). */
  say?: string;
  /** Words to say when the lead has no mobileScore. */
  sayGeneric?: string;
  /** Delivery note for the caller. Never spoken. */
  hint?: string;
  /** Responses, speed variant. Terminal nodes have none. */
  responses?: CallFlowResponse[];
  /** Responses when the lead has no mobileScore. */
  responsesGeneric?: CallFlowResponse[];
  terminal?: boolean;
  /** Disposition the panel preselects on a terminal card. */
  suggestedDisposition?: CallDisposition;
  /** Terminal cards that should ask for a follow up date. */
  followUp?: boolean;
}

export const CALL_FLOW_START_ID = "start";

export const CALL_FLOW_NODES: CallFlowNode[] = [
  {
    id: "start",
    stage: "Who answered",
    title: "Who answered?",
    say: "Dial {{company}} and see who picks up. If the owner answers, stay on this flow. If staff answer, the gatekeeper card is next. If nobody picks up, log it and move on.",
    hint: "Never pitch anyone but the owner or the decision maker. Staff get the gatekeeper script, not the offer.",
    responses: [
      { label: "The owner or decision maker", next: "opener" },
      { label: "A gatekeeper or staff member", next: "gatekeeperAsk" },
      { label: "Voicemail", next: "voicemailScript" },
      { label: "No answer", next: "noAnswer" },
    ],
  },
  {
    id: "noAnswer",
    stage: "Who answered",
    title: "No answer",
    say: "Nobody picked up. Log the call and move to the next lead. If this one matters, try again at a different time of day.",
    terminal: true,
    suggestedDisposition: "NO_ANSWER",
  },
  {
    id: "gatekeeperAsk",
    stage: "Gatekeeper",
    title: "Ask for the owner",
    say: "Hi, my name is Amir. Could you put me through to {{decisionMaker}} if they are around? It is about the {{company}} website. {{hook}} It will take two minutes of their time, and if it is not relevant I will leave it with you.",
    hint: "Be direct and give the specific reason. Never use false familiarity, and never pretend the owner is expecting your call.",
    responses: [
      { label: "Putting you through", next: "opener" },
      { label: "Owner not available", next: "gatekeeperBestTime" },
      { label: "They ask what it is about", next: "gatekeeperExplain" },
      { label: "Refuses, no way through", next: "gatekeeperBlocked" },
    ],
  },
  {
    id: "gatekeeperExplain",
    stage: "Gatekeeper",
    title: "Say honestly what it is about",
    say: "They are not expecting me, I will not pretend otherwise. I fix WordPress websites, and I checked the {{company}} site before I called. {{hook}} You are welcome to tell them exactly that and let them decide. Or if email is better, I can send a one page report instead.",
    hint: "Honesty is the whole move here. A specific, checkable reason gets passed on, a vague business opportunity gets screened out.",
    responses: [
      { label: "Putting you through", next: "opener" },
      { label: "Still no", next: "gatekeeperBestTime" },
    ],
  },
  {
    id: "gatekeeperBestTime",
    stage: "Gatekeeper",
    title: "Ask for the best time",
    say: "No problem at all. When is the best time to catch {{decisionMaker}} directly? Early morning before you open, or later in the day?",
    hint: "Write the time they give you in the notes, and set the follow up date below before you save.",
    terminal: true,
    suggestedDisposition: "CALLBACK",
    followUp: true,
  },
  {
    id: "gatekeeperBlocked",
    stage: "Gatekeeper",
    title: "Blocked at the desk",
    say: "No problem at all, thanks for your help. I will try another time.",
    hint: "Try early in the morning or late in the day, when the owner often answers the phone themselves. Two blocked attempts is enough. Do not fight the desk.",
    terminal: true,
    suggestedDisposition: "GATEKEEPER",
  },
  {
    id: "opener",
    stage: "Opener",
    title: "Permission opener",
    say: "Hi, is that {{firstName}}? {{firstName}}, my name is Amir. I will be honest, this is a cold call, but it is a researched one. Can I take 30 seconds to tell you why I called, and then you can tell me if it is worth carrying on or not?",
    hint: "Calm, neutral tone, no hype. Owning the cold call and asking for 30 seconds with an out is the opener the call data backs.",
    responses: [
      { label: "Go ahead", next: "reason" },
      { label: "Who is this, what is it about?", next: "openerShort" },
      { label: "Bad time", next: "badTime" },
      { label: "Not interested", next: "notInterestedEarly" },
    ],
  },
  {
    id: "openerShort",
    stage: "Opener",
    title: "The 10 second version",
    say: "Fair question. I am Amir, I make WordPress websites faster and fix the problems that hold them back. I called because of one specific thing. {{hook}} Give me 30 seconds and then decide.",
    hint: "One honest sentence about who you are, one specific reason, then stop talking.",
    responses: [
      { label: "Go ahead", next: "reason" },
      { label: "Not interested", next: "notInterestedEarly" },
      { label: "Bad time", next: "badTime" },
    ],
  },
  {
    id: "badTime",
    stage: "Opener",
    title: "Bad time",
    say: "No problem at all, I will let you go. When is a better moment, later today or tomorrow morning?",
    hint: "Never pitch on a bad time call. Just book the retry, write it in the notes and set the follow up date below.",
    terminal: true,
    suggestedDisposition: "CALLBACK",
    followUp: true,
  },
  {
    id: "notInterestedEarly",
    stage: "Opener",
    title: "Not interested, before the reason",
    say: "That is fair, I know you did not ask me to call, and most people say that before they hear why I rang. Before I go, just so nobody from my side bugs you again: is it that the website side is all handled and fast enough, or is it just that cold calls are not your thing?",
    hint: "Agree first, never argue. One isolate question separates a handled website from a reflex no. One attempt only.",
    responses: [
      { label: "It is handled", next: "closeFile" },
      { label: "Just the cold call", next: "reasonOneLine" },
      { label: "Stays no", next: "closeFile" },
    ],
  },
  {
    id: "reasonOneLine",
    stage: "Opener",
    title: "One line, then one question",
    say: "Understood, one line then. {{hook}} Can I ask you one quick question about it?",
    hint: "Keep it to the one line you promised. If they say no to the question, the file closes on the next card.",
    responses: [
      { label: "Okay, ask", next: "painQuestion" },
      { label: "No", next: "closeFile" },
    ],
  },
  {
    id: "reason",
    stage: "The reason",
    title: "The reason for the call",
    say: "Thank you. The reason I called is, before I rang, I ran your website through Google's own PageSpeed test, the mobile one, how most people find you. {{company}} scored {{mobileScore}} out of 100, and the main content took {{lcp}} to show up on a phone. Google calls under two and a half seconds good. You can run the exact same test yourself and you will see the exact same number.",
    sayGeneric:
      "Thank you. The reason I called is, before I rang, I took a close look at the {{company}} website and found one specific thing. {{hook}} It is the kind of problem that quietly costs bookings, and most owners never get told about it.",
    hint: "State the reason plainly and stop. Their own evidence does the persuading, not adjectives.",
    responses: [{ label: "Continue", next: "painQuestion" }],
  },
  {
    id: "painQuestion",
    stage: "The problem",
    title: "Let them name the cost",
    say: "Can I ask, when someone finds you on their phone, maybe from Google Maps or an ad, and the page takes {{lcp}} to load, what do you reckon most of them do?",
    sayGeneric:
      "Can I ask about what I found? {{painPoints}} When a customer runs into that on your site, what do you reckon most of them do?",
    hint: "Ask once, then stay quiet. A cost they say out loud in their own words is worth more than any claim you could make.",
    responses: [
      { label: "They leave, or go elsewhere", next: "painCost" },
      { label: "We get plenty of business anyway", next: "painInvisible" },
      { label: "Our web person handles that", next: "webGuy" },
      { label: "Not sure", next: "painCost" },
    ],
  },
  {
    id: "painCost",
    stage: "The problem",
    title: "The cost, in one line",
    say: "That is what Google's own research says too, most mobile visits are given up on after about three seconds. Has anyone, you or whoever looks after the site, ever looked at this side of it before?",
    hint: "The three second figure is Google's research, attributed as such. Never turn it into a claim about this business's own losses.",
    responses: [
      { label: "Nobody has", next: "proof" },
      { label: "The web person has", next: "webGuy" },
      { label: "Continue anyway", next: "proof" },
    ],
  },
  {
    id: "painInvisible",
    stage: "The problem",
    title: "The bookings you never see",
    say: "That is the thing with a slow or broken page. The customers it costs you are invisible. They never call, never book, never complain. You only ever meet the ones who pushed through. The ones who left just show up as a quieter week.",
    hint: "Say it once, calmly, then move on. This is framing, not pressure.",
    responses: [
      { label: "Continue", next: "proof" },
      { label: "Our web person handles that", next: "webGuy" },
    ],
  },
  {
    id: "proof",
    stage: "Proof",
    title: "Proof, in one breath",
    say: "Reason I ask is, that is literally all I do. Since 2018 I have made WordPress sites faster and fixed the problems that hold them back. I have 121 reviews on Fiverr at 4.9 stars and 25 rated jobs on Upwork, and I am happy to send you the links so you can check I am real before you pay me a penny.",
    hint: "One breath, then stop. Proof offered for checking beats proof argued.",
    responses: [{ label: "Continue", next: "offer" }],
  },
  {
    id: "offer",
    stage: "The offer",
    title: "The offer",
    say: "Here is what it looks like. It is a one off fixed price, for a site like yours between $45 and $195, not an hourly rate and there is no monthly contract. I fix the images, the caching and the code that is blocking the page, everything that test flags, and you get a before and after report with the same Google test, so you can see the score move with your own eyes. If the after test does not show a real improvement, you do not pay. Most sites are turned around in two to three days, and all I need from you is access.",
    sayGeneric:
      "Here is what I would suggest. Let me do a free review of the exact problem I found, and send you a short report: what is causing it, what fixing it involves, and a fixed price in writing. No obligation, and no hourly billing. If the report does not convince you, that is the end of it.",
    hint: "Promise only the measured improvement. Never promise a 100 score or a search ranking, nobody can guarantee either.",
    responses: [
      { label: "How much does it cost?", next: "priceAnswer" },
      { label: "Send me an email", next: "emailObjection" },
      { label: "We already have a web person", next: "webGuy" },
      { label: "I need to think about it", next: "thinkAboutIt" },
      { label: "Sounds good", next: "closeWarm" },
    ],
    responsesGeneric: [
      { label: "How much does it cost?", next: "priceAnswerGeneric" },
      { label: "Send me an email", next: "emailObjection" },
      { label: "We already have a web person", next: "webGuy" },
      { label: "I need to think about it", next: "thinkAboutIt" },
      { label: "Sounds good", next: "closeWarm" },
    ],
  },
  {
    id: "priceAnswer",
    stage: "The offer",
    title: "How much does it cost?",
    say: "Straight answer: it is fixed, one time, between $45 and $195 depending on the size of the site, and the exact price for your site will be in the report, in writing. No hourly billing, no monthly contract, and you see a before and after Google report.",
    hint: "Answer the price question directly and early. Dodging it costs more trust than the number ever will.",
    responses: [
      { label: "Okay", next: "closeReport" },
      { label: "Too much", next: "thinkAboutIt" },
      { label: "Not interested", next: "notInterestedLate" },
    ],
  },
  {
    id: "priceAnswerGeneric",
    stage: "The offer",
    title: "How much does it cost?",
    say: "Honest answer: the price depends on what the fix actually involves, which is exactly what the free review works out. The review ends with a fixed price in writing, so there are no hourly billing surprises, and you decide with the number in front of you.",
    hint: "Never invent a price for work you have not scoped. The fixed price in writing is the promise, not a number guessed on a cold call.",
    responses: [
      { label: "Okay", next: "closeReport" },
      { label: "Not interested", next: "notInterestedLate" },
    ],
  },
  {
    id: "emailObjection",
    stage: "Objections",
    title: "Send me an email",
    say: "Happy to, and I will, today. So I do not send you something irrelevant, the email would just be your one page report: the problem I found, what is causing it, what I would fix and the fixed price. Is that the thing you would actually want to see, or, be honest, it is fine, is send me an email a polite way of saying not interested?",
    hint: "Ask it warmly, never as a challenge. Send me an email is either real interest or a polite brush off, and either answer moves the call forward.",
    responses: [
      { label: "Yes, send the report", next: "closeReport" },
      { label: "It was a brush off", next: "closeFile" },
      { label: "Book the walkthrough instead", next: "closeReport" },
    ],
  },
  {
    id: "webGuy",
    stage: "Objections",
    title: "We already have a web person",
    say: "Good, you should have someone. I am not looking to replace them, I only do this one piece, one off, and it is the bit that often never gets to the top of a web person's list. Quick question so I do not waste your time: have they ever mentioned this specific problem to you, or is it something nobody has looked at? Either way, let me send you the free report. You can even hand it to them. If they want to fix it, great. If not, you have my price in writing.",
    hint: "Never attack the person already doing the work. Wedge in alongside them, and let the report do the comparing.",
    responses: [
      { label: "Send the report", next: "closeReport" },
      { label: "He will fix it", next: "closeFileHappy" },
      { label: "Not interested", next: "notInterestedLate" },
    ],
  },
  {
    id: "thinkAboutIt",
    stage: "Objections",
    title: "I need to think about it",
    say: "Of course. So I do not chase you like every other caller, is it the money, is it whether it will actually work, or is it just timing?",
    hint: "One question isolates the real objection. Answer that one thing, then offer the smallest next step.",
    responses: [
      { label: "Money", next: "moneyAnswer" },
      { label: "Whether it works", next: "proofAnswer" },
      { label: "Timing", next: "closeReport" },
      { label: "Just no", next: "notInterestedLate" },
    ],
  },
  {
    id: "moneyAnswer",
    stage: "Objections",
    title: "It is the money",
    say: "Understood. To be clear on the money side: it is a fixed one time price between $45 and $195, no contract, and you do not pay if the after test shows no real improvement. The smallest next step is the free report, so you see the exact price and the plan before spending anything.",
    sayGeneric:
      "Understood. To be clear on the money side: the review and the report are free, and they end with a fixed price in writing. No contract, no hourly billing. You only decide when you can see the number.",
    hint: "Shrink the decision, not the price. The free report is the smallest step that keeps the conversation alive.",
    responses: [
      { label: "Okay", next: "closeReport" },
      { label: "Still no", next: "closeFile" },
    ],
  },
  {
    id: "proofAnswer",
    stage: "Objections",
    title: "Will it actually work?",
    say: "Fair question. That is exactly why the before and after are measured with Google's own test, not by me. You see your score today, and the same test after the work. If the number does not move, you do not pay. The report is free, so you can judge it on numbers, not on my say so.",
    sayGeneric:
      "Fair question. That is why the first step is the free review. It shows you the exact problem, the evidence for it, and what the fix involves, before you spend anything. You judge it on the report, not on my say so.",
    hint: "The measurement is the proof. Offer to be judged on it.",
    responses: [
      { label: "Okay", next: "closeReport" },
      { label: "Still no", next: "closeFile" },
    ],
  },
  {
    id: "notInterestedLate",
    stage: "Objections",
    title: "Not interested, after the offer",
    say: "That is fair. Before I go, one quick thing so I close this properly: is it that this side of the website is handled, or is it just timing?",
    hint: "The short form of the early isolate. One attempt only, then honour the answer completely.",
    responses: [
      { label: "Handled", next: "closeFile" },
      { label: "Just timing", next: "closeReport" },
      { label: "No means no", next: "closeFile" },
      { label: "Do not call me again", next: "doNotCall" },
    ],
  },
  {
    id: "closeReport",
    stage: "Close",
    title: "Book the report and walkthrough",
    say: "Perfect. I will send you the free one page report today, and let us take ten minutes to walk through it together. What is the best email for the report? Let me spell that back so I have it right. And for the walkthrough, would tomorrow morning or tomorrow afternoon suit you better? I will send the calendar invite straight after this call. Could you tap accept when it lands, so I know it arrived?",
    hint: "Confirm the email out loud, letter by letter. Set the follow up date below to the walkthrough time before you save.",
    terminal: true,
    suggestedDisposition: "INTERESTED",
    followUp: true,
  },
  {
    id: "closeWarm",
    stage: "Close",
    title: "They want it done",
    say: "Great, let us get it done. I will book you in. It is a fixed one time price, and you will see the before and after Google report when it is finished. I just need the best email for the invoice and the access details form. Shall I lock that in?",
    sayGeneric:
      "Great. The first step is the free review, and right after it you get the fixed price in writing, before any work starts. I just need the best email for the report and the access details form. Shall I get that started?",
    hint: "Confirm the email out loud. Set a follow up date below for the delivery or the review check in.",
    terminal: true,
    suggestedDisposition: "INTERESTED",
    followUp: true,
  },
  {
    id: "closeFileHappy",
    stage: "Close",
    title: "Polite exit, problem in hand",
    say: "Perfect, glad it is in hand. Thanks for your time. If the problem ever does bite, search for AamirTechs and you will find me. All the best.",
    hint: "A warm exit keeps the door open without chasing. Log it as Talked, no follow up needed.",
    terminal: true,
    suggestedDisposition: "TALKED",
  },
  {
    id: "closeFile",
    stage: "Close",
    title: "Close the file",
    say: "Understood, and thanks for being straight with me. I will close the file and you will not hear from us again. All the best.",
    hint: "Then actually close it. A maybe you keep chasing burns the minutes you need for real prospects.",
    terminal: true,
    suggestedDisposition: "NOT_INTERESTED",
  },
  {
    id: "doNotCall",
    stage: "Close",
    title: "Do not call again",
    say: "I am sorry about that. I have removed your number and you will not get another call from us. Goodbye.",
    hint: "Save this call with the Do not call outcome so the number is never dialled again.",
    terminal: true,
    suggestedDisposition: "DO_NOT_CALL",
  },
  {
    id: "voicemailScript",
    stage: "Voicemail",
    title: "Leave the voicemail",
    say: "{{firstName}}, it is Amir. I ran the {{company}} website through Google's PageSpeed test and it scored {{mobileScore}} out of 100 on mobile. I am sending you a short email now with the report, subject line Your PageSpeed score. No need to call back.",
    sayGeneric:
      "{{firstName}}, it is Amir. I found a specific problem on the {{company}} website. {{hook}} I am sending you a short email now with the report, subject line Your website report. No need to call back.",
    hint: "Under 20 seconds, context only, no pitch and no price. The goal is the email reply, not a callback. Send the matching email within minutes, and leave at most two voicemails for any prospect.",
    terminal: true,
    suggestedDisposition: "VOICEMAIL",
  },
];

const NODE_BY_ID = new Map<string, CallFlowNode>(
  CALL_FLOW_NODES.map((node) => [node.id, node]),
);

/** The node with this id, or undefined when the id is not in the flow. */
export function getFlowNode(id: string): CallFlowNode | undefined {
  return NODE_BY_ID.get(id);
}

/** True when the lead carries a measured mobile score. */
export function leadHasMobileScore(context: ScriptLeadContext): boolean {
  return Boolean(scriptValuesForLead(context).mobilescore);
}

export interface ResolvedFlowNode {
  node: CallFlowNode;
  /** The say text for this lead, placeholders filled. */
  say: string;
  /** The delivery hint, or empty when the node has none. */
  hint: string;
  /** The response buttons for this lead's variant. */
  responses: CallFlowResponse[];
  terminal: boolean;
}

/**
 * Resolve a node for one lead: pick the speed or generic variant
 * by whether the lead has a mobile score, and render the say text
 * through the shared script renderer so the caller reads the
 * lead's real name, company, hook and numbers, never a token.
 */
export function resolveFlowNode(
  node: CallFlowNode,
  context: ScriptLeadContext,
): ResolvedFlowNode {
  const hasScore = leadHasMobileScore(context);
  const sayTemplate = hasScore ? node.say : (node.sayGeneric ?? node.say);
  const responses = hasScore
    ? (node.responses ?? [])
    : (node.responsesGeneric ?? node.responses ?? []);
  return {
    node,
    say: sayTemplate ? renderScriptTemplate(sayTemplate, context) : "",
    hint: node.hint ?? "",
    responses,
    terminal: Boolean(node.terminal),
  };
}

/** Every response edge of a node, across both variants. */
function allResponses(node: CallFlowNode): CallFlowResponse[] {
  return [...(node.responses ?? []), ...(node.responsesGeneric ?? [])];
}

/**
 * Graph integrity for the flow, as a list of problems. An empty
 * list means: ids are unique, the start node exists, every
 * response target exists, terminal nodes carry a valid suggested
 * disposition and no responses, every non terminal node offers at
 * least one response in each variant it can be shown in, every
 * node is reachable from the start, and every node can reach a
 * terminal node, so no call can dead end.
 */
export function validateFlow(nodes: CallFlowNode[] = CALL_FLOW_NODES): string[] {
  const problems: string[] = [];
  const byId = new Map<string, CallFlowNode>();
  for (const node of nodes) {
    if (byId.has(node.id)) problems.push(`Duplicate node id: ${node.id}`);
    byId.set(node.id, node);
  }
  if (!byId.has(CALL_FLOW_START_ID)) {
    problems.push(`Start node "${CALL_FLOW_START_ID}" is missing`);
  }
  for (const node of nodes) {
    if (node.terminal) {
      if (!node.suggestedDisposition || !isCallDisposition(node.suggestedDisposition)) {
        problems.push(`Terminal node ${node.id} has no valid suggested disposition`);
      }
      if (allResponses(node).length > 0) {
        problems.push(`Terminal node ${node.id} must not have responses`);
      }
    } else {
      if ((node.responses ?? []).length === 0) {
        problems.push(`Node ${node.id} has no responses`);
      }
      // The generic variant resolves through responsesGeneric when
      // present and falls back to responses when not, so it is only
      // broken when both are empty, which the check above covers.
    }
    for (const response of allResponses(node)) {
      if (!byId.has(response.next)) {
        problems.push(`Node ${node.id} points at missing node ${response.next}`);
      }
    }
  }
  if (problems.length > 0) return problems;

  // Reachable from the start, following every variant's edges.
  const reachable = new Set<string>([CALL_FLOW_START_ID]);
  const queue = [CALL_FLOW_START_ID];
  while (queue.length > 0) {
    const current = byId.get(queue.shift() as string);
    if (!current) continue;
    for (const response of allResponses(current)) {
      if (!reachable.has(response.next)) {
        reachable.add(response.next);
        queue.push(response.next);
      }
    }
  }
  for (const node of nodes) {
    if (!reachable.has(node.id)) problems.push(`Node ${node.id} is not reachable from the start`);
  }

  // Every node can reach a terminal: walk backwards from the
  // terminal nodes over reversed edges.
  const reverseEdges = new Map<string, string[]>();
  for (const node of nodes) {
    for (const response of allResponses(node)) {
      const list = reverseEdges.get(response.next) ?? [];
      list.push(node.id);
      reverseEdges.set(response.next, list);
    }
  }
  const canTerminate = new Set<string>(
    nodes.filter((node) => node.terminal).map((node) => node.id),
  );
  const backQueue = [...canTerminate];
  while (backQueue.length > 0) {
    const current = backQueue.shift() as string;
    for (const parent of reverseEdges.get(current) ?? []) {
      if (!canTerminate.has(parent)) {
        canTerminate.add(parent);
        backQueue.push(parent);
      }
    }
  }
  for (const node of nodes) {
    if (!canTerminate.has(node.id)) {
      problems.push(`Node ${node.id} can never reach a terminal node`);
    }
  }
  return problems;
}

/**
 * The roadmap: stages in the order they first appear in the flow,
 * each with its nodes in authored order. The call panel renders
 * this as the outline of every possibility before or during a
 * call.
 */
export function flowRoadmap(
  nodes: CallFlowNode[] = CALL_FLOW_NODES,
): { stage: string; nodes: CallFlowNode[] }[] {
  const stages: { stage: string; nodes: CallFlowNode[] }[] = [];
  const byStage = new Map<string, CallFlowNode[]>();
  for (const node of nodes) {
    let list = byStage.get(node.stage);
    if (!list) {
      list = [];
      byStage.set(node.stage, list);
      stages.push({ stage: node.stage, nodes: list });
    }
    list.push(node);
  }
  return stages;
}
