import type { FetchResult, MessageSource, NormalizedInboundMessage } from "./types";

/**
 * In-memory MessageSource for tests and local smoke runs.
 *
 * It deliberately ignores the cursor and returns its full message list
 * on every call, modelling a provider that redelivers: idempotency is
 * the sync service's job, and this source exists to prove the service
 * does it. Never used against a real mailbox.
 */
export class FakeSource implements MessageSource {
  readonly id = "fake";

  constructor(private readonly messages: NormalizedInboundMessage[]) {}

  async fetchNewMessages(): Promise<FetchResult> {
    return { messages: this.messages, cursor: "fake-cursor" };
  }
}
