/**
 * Product tour steps (v1.6.0).
 *
 * The first-run tour walks a new user along the same path as the
 * dashboard getting started checklist: identity, sending account,
 * leads, campaign, sequence, launch, then the two places results
 * show up. Each step names the page it lives on and a `data-tour`
 * anchor rendered by that page; the tour component navigates to the
 * page, highlights the anchor, and explains the one idea that
 * matters there. Copy stays short on purpose: a tour that reads
 * like documentation gets skipped.
 *
 * This module is pure data so the client component, the checklist,
 * and tests all share one definition.
 */

export interface TourStep {
  id: string;
  route: string;
  /** CSS selector for the element to highlight on the page. */
  target: string;
  title: string;
  body: string;
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: "welcome",
    route: "/app",
    target: '[data-tour="checklist"]',
    title: "Welcome to ColdReach",
    body: "This two minute tour walks the path from an empty workspace to a sending campaign. The getting started checklist is your home base: it reads live workspace state and checks off each setup step as you complete it, wherever you complete it.",
  },
  {
    id: "identity",
    route: "/app/settings",
    target: '[data-tour="identity"]',
    title: "Set your sender identity",
    body: "Your sender name and postal address appear in the footer of every email you send. CAN-SPAM requires a real postal address, so this is step one before anything goes out.",
  },
  {
    id: "accounts",
    route: "/app/accounts",
    target: '[data-tour="accounts"]',
    title: "Connect a sending account",
    body: "Campaigns send from mailboxes you connect here: Gmail or Microsoft 365, your own SMTP server (cPanel works well), or a simulation account for practice runs. New accounts ramp up gradually from a small daily limit so inboxes learn to trust them.",
  },
  {
    id: "leads",
    route: "/app/leads",
    target: '[data-tour="leads"]',
    title: "Build a lead list and import",
    body: "Create a list, then import a CSV and map its columns. Every import is deduplicated, verified, and checked against suppression before anything is saved. Two columns are worth including: country, so each lead is scheduled in its own timezone, and icebreaker, a personal opening line for each lead.",
  },
  {
    id: "campaigns",
    route: "/app/campaigns",
    target: '[data-tour="campaigns"]',
    title: "Create a campaign",
    body: "A campaign is one sequence sent to one list from your connected accounts. Create it here, attach the list it should send to, and choose which accounts send it.",
  },
  {
    id: "sequence",
    route: "/app/campaigns",
    target: '[data-tour="campaigns-table"]',
    title: "Write the sequence",
    body: "Open a campaign to write its steps. Tokens like {{firstName}} and {{icebreaker}} personalise every email, follow-up steps send after the delays you set, and a campaign signature is added automatically at send time.",
  },
  {
    id: "preflight",
    route: "/app/campaigns",
    target: '[data-tour="campaigns-table"]',
    title: "Schedule, preflight, launch",
    body: "Each campaign sends inside a daily window on business days, timed per lead timezone. Enrolling a list stamps every lead's first send, and preflight checks tokens, suppression, and account capacity before launch. Launch stays blocked until preflight passes, so nothing sends half ready.",
  },
  {
    id: "inbox",
    route: "/app/inbox",
    target: '[data-tour="inbox"]',
    title: "Replies land in the Inbox",
    body: "Every connected mailbox syncs here into one inbox. When a lead replies, their follow-ups stop automatically, and bounces and unsubscribes suppress them across every campaign.",
  },
  {
    id: "outbox",
    route: "/app/outbox",
    target: '[data-tour="outbox"]',
    title: "Track sends in the Outbox",
    body: "Every email the worker sends is listed here with its status, opens, and replies, so you can see exactly what went out, from which account, and what it did. That is the whole loop: set up once, then watch real sending.",
  },
];

/** Index of a step by id, or -1. Accepts "start" for the first step. */
export function tourStepIndex(id: string): number {
  if (id === "start") {
    return 0;
  }
  return TOUR_STEPS.findIndex((step) => step.id === id);
}
