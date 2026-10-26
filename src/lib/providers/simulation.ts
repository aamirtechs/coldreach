import { randomUUID } from "node:crypto";
import type { MailProvider, SendInput, SendResult } from "./types";

/**
 * DEMO provider. It performs no network activity at all: the message is
 * "sent" only in the sense that the platform records a send event and
 * advances the sequence, which lets the full campaign lifecycle be
 * exercised without mail credentials. Every UI surface labels results
 * from this provider as DEMO.
 */
export class SimulationProvider implements MailProvider {
  readonly id = "simulation";
  readonly isSimulation = true;

  async send(_input: SendInput): Promise<SendResult> {
    return { providerMessageId: `demo-${randomUUID()}` };
  }
}
