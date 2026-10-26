/**
 * Mail provider contract.
 *
 * Every sending path in ColdReach goes through this interface, so the
 * worker never knows which transport carried a message. Implementations
 * either send for real (SMTP today, OAuth providers in Phase 3) or
 * simulate under an explicit DEMO label.
 */

export interface SendInput {
  fromEmail: string;
  fromName?: string | null;
  toEmail: string;
  subject: string;
  text: string;
  html: string;
  headers?: Record<string, string>;
}

export interface SendResult {
  providerMessageId: string;
}

export interface MailProvider {
  /** Stable identifier, for example "simulation" or "smtp". */
  readonly id: string;
  /** True when this provider never touches a real mail server. */
  readonly isSimulation: boolean;
  send(input: SendInput): Promise<SendResult>;
}
