/**
 * Support constants shared by the server ticket module and the
 * client form. Kept dependency free so importing this file from a
 * client component never drags server code into the browser bundle.
 */

export const SUPPORT_CATEGORIES = [
  "Sending problem",
  "Billing",
  "Account and login",
  "Feature request",
  "Something else",
] as const;

export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];

export const SUPPORT_TICKET_STATUSES = ["OPEN", "CLOSED"] as const;
export type SupportTicketStatus = (typeof SUPPORT_TICKET_STATUSES)[number];

export const MAX_TICKET_SUBJECT_LENGTH = 150;
export const MAX_TICKET_MESSAGE_LENGTH = 5000;

export const DEFAULT_SUPPORT_EMAIL = "amir@aamirtechs.com";

/** WhatsApp contact shown on the Support page, international format. */
export const SUPPORT_WHATSAPP_NUMBER = "923143976456";
export const SUPPORT_WHATSAPP_DISPLAY = "+92 314 3976456";

export function supportWhatsAppLink(): string {
  const text = encodeURIComponent("Hi ColdReach support, I need help with my account.");
  return `https://wa.me/${SUPPORT_WHATSAPP_NUMBER}?text=${text}`;
}
