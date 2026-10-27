import type { SendingAccount } from "@prisma/client";
import { describe, expect, it } from "vitest";
import type { MailboxCredentials } from "@/lib/providers/smtp";
import {
  ImapSource,
  type ImapClientLike,
  type ImapFetchedMessage,
} from "./imapSource";

const CREDS: MailboxCredentials = {
  smtp: { host: "mail.example.com", port: 465, secure: true },
  imap: { host: "mail.example.com", port: 993, secure: true },
  user: "owner@example.com",
  pass: "fake-mailbox-password",
};

const NOW = new Date("2026-10-27T12:00:00Z");

const ACCOUNT = {
  id: "acct-1",
  email: "owner@example.com",
  provider: "SMTP",
} as SendingAccount;

interface FakeMessage {
  uid: number;
  date: Date;
  raw: string;
}

function rawEmail(args: {
  messageId: string;
  from: string;
  subject: string;
  date: Date;
  body: string;
  inReplyTo?: string;
  references?: string[];
  html?: boolean;
}): string {
  const lines = [
    `Message-ID: <${args.messageId}>`,
    `From: ${args.from}`,
    "To: owner@example.com",
    `Subject: ${args.subject}`,
    `Date: ${args.date.toUTCString()}`,
  ];
  if (args.inReplyTo) {
    lines.push(`In-Reply-To: <${args.inReplyTo}>`);
  }
  if (args.references && args.references.length > 0) {
    lines.push(`References: ${args.references.map((ref) => `<${ref}>`).join(" ")}`);
  }
  lines.push(
    args.html ? "Content-Type: text/html; charset=utf-8" : "Content-Type: text/plain; charset=utf-8",
    "",
    args.body,
  );
  return lines.join("\r\n");
}

class FakeImapClient implements ImapClientLike {
  mailbox: { uidValidity: bigint; uidNext: number };
  connected = false;
  loggedOut = false;
  lockReleased = false;

  constructor(
    private readonly messages: FakeMessage[],
    uidValidity: bigint = 4242n,
  ) {
    const maxUid = messages.reduce((max, m) => Math.max(max, m.uid), 0);
    this.mailbox = { uidValidity, uidNext: maxUid + 1 };
  }

  async connect(): Promise<void> {
    this.connected = true;
  }

  async logout(): Promise<void> {
    this.loggedOut = true;
  }

  async getMailboxLock(): Promise<{ release(): void }> {
    return {
      release: () => {
        this.lockReleased = true;
      },
    };
  }

  async search(
    query: { since?: Date; all?: boolean; uid?: string },
  ): Promise<number[]> {
    let selected = this.messages;
    if (query.since) {
      const since = query.since;
      selected = selected.filter((m) => m.date.getTime() >= since.getTime());
    }
    return selected.map((m) => m.uid);
  }

  async fetchOne(seq: string): Promise<ImapFetchedMessage | false> {
    const message = this.messages.find((m) => m.uid === Number(seq));
    if (!message) {
      return false;
    }
    return { uid: message.uid, internalDate: message.date, source: Buffer.from(message.raw) };
  }
}

function sourceFor(client: FakeImapClient): ImapSource {
  return new ImapSource(CREDS, {
    clientFactory: () => client,
    now: () => NOW,
  });
}

const OLD_MESSAGE: FakeMessage = {
  uid: 1,
  date: new Date("2026-10-18T09:00:00Z"),
  raw: rawEmail({
    messageId: "old-1@mail.example.com",
    from: "Old Sender <old@example.com>",
    subject: "Old thread",
    date: new Date("2026-10-18T09:00:00Z"),
    body: "This one is outside the first sync window.",
  }),
};

const REPLY_MESSAGE: FakeMessage = {
  uid: 2,
  date: new Date("2026-10-26T10:00:00Z"),
  raw: rawEmail({
    messageId: "reply-1@mail.example.com",
    from: "Prospect Person <prospect@example.com>",
    subject: "Re: Quick intro",
    date: new Date("2026-10-26T10:00:00Z"),
    body: "Yes, I am interested. Can we book a call?",
    inReplyTo: "sent-1@coldreach",
    references: ["root-1@coldreach", "sent-1@coldreach"],
  }),
};

const HTML_MESSAGE: FakeMessage = {
  uid: 3,
  date: new Date("2026-10-27T08:00:00Z"),
  raw: rawEmail({
    messageId: "html-1@mail.example.com",
    from: "html@example.com",
    subject: "HTML only reply",
    date: new Date("2026-10-27T08:00:00Z"),
    body: "<p>Hello <b>there</b></p><p>Second line</p>",
    html: true,
  }),
};

describe("ImapSource first sync", () => {
  it("imports only the last 7 days and baselines the cursor at the highest UID", async () => {
    const client = new FakeImapClient([OLD_MESSAGE, REPLY_MESSAGE, HTML_MESSAGE]);
    const result = await sourceFor(client).fetchNewMessages(ACCOUNT, null);
    expect(result.messages.map((m) => m.providerMessageId)).toEqual([
      "reply-1@mail.example.com",
      "html-1@mail.example.com",
    ]);
    const cursor = JSON.parse(result.cursor) as { uidValidity: string; lastUid: number };
    expect(cursor).toEqual({ uidValidity: "4242", lastUid: 3 });
    expect(client.connected).toBe(true);
    expect(client.lockReleased).toBe(true);
    expect(client.loggedOut).toBe(true);
  });

  it("normalizes headers, reply chain, and bodies", async () => {
    const client = new FakeImapClient([REPLY_MESSAGE, HTML_MESSAGE]);
    const result = await sourceFor(client).fetchNewMessages(ACCOUNT, null);
    const reply = result.messages[0];
    expect(reply.fromEmail).toBe("prospect@example.com");
    expect(reply.toEmail).toBe("owner@example.com");
    expect(reply.subject).toBe("Re: Quick intro");
    expect(reply.inReplyTo).toBe("sent-1@coldreach");
    expect(reply.references).toEqual(["root-1@coldreach", "sent-1@coldreach"]);
    expect(reply.bodyText).toContain("book a call");
    expect(reply.receivedAt.toISOString()).toBe("2026-10-26T10:00:00.000Z");
    const html = result.messages[1];
    expect(html.bodyText).toContain("Hello there");
    expect(html.bodyText).toContain("Second line");
    expect(html.bodyText).not.toContain("<b>");
  });

  it("caps the first sync at the newest 100 messages", async () => {
    const many: FakeMessage[] = [];
    for (let uid = 1; uid <= 105; uid += 1) {
      const date = new Date(NOW.getTime() - 60_000);
      many.push({
        uid,
        date,
        raw: rawEmail({
          messageId: `bulk-${uid}@mail.example.com`,
          from: "bulk@example.com",
          subject: `Bulk ${uid}`,
          date,
          body: `Body ${uid}`,
        }),
      });
    }
    const client = new FakeImapClient(many);
    const result = await sourceFor(client).fetchNewMessages(ACCOUNT, null);
    expect(result.messages).toHaveLength(100);
    expect(result.messages[0].providerMessageId).toBe("bulk-6@mail.example.com");
    const cursor = JSON.parse(result.cursor) as { lastUid: number };
    expect(cursor.lastUid).toBe(105);
  });
});

describe("ImapSource later syncs", () => {
  it("fetches only UIDs above the cursor and advances it", async () => {
    const first = await sourceFor(
      new FakeImapClient([OLD_MESSAGE, REPLY_MESSAGE]),
    ).fetchNewMessages(ACCOUNT, null);

    const newMessage: FakeMessage = {
      uid: 4,
      date: new Date("2026-10-27T11:00:00Z"),
      raw: rawEmail({
        messageId: "reply-2@mail.example.com",
        from: "prospect@example.com",
        subject: "Re: Quick intro",
        date: new Date("2026-10-27T11:00:00Z"),
        body: "Following up on my last note.",
        inReplyTo: "sent-1@coldreach",
        references: ["sent-1@coldreach"],
      }),
    };
    const client = new FakeImapClient([OLD_MESSAGE, REPLY_MESSAGE, HTML_MESSAGE, newMessage]);
    const result = await sourceFor(client).fetchNewMessages(ACCOUNT, first.cursor);
    expect(result.messages.map((m) => m.providerMessageId)).toEqual([
      "html-1@mail.example.com",
      "reply-2@mail.example.com",
    ]);
    const cursor = JSON.parse(result.cursor) as { lastUid: number };
    expect(cursor.lastUid).toBe(4);

    // Nothing new: no messages, and the cursor stays put.
    const idle = await sourceFor(
      new FakeImapClient([OLD_MESSAGE, REPLY_MESSAGE, HTML_MESSAGE, newMessage]),
    ).fetchNewMessages(ACCOUNT, result.cursor);
    expect(idle.messages).toEqual([]);
    expect(JSON.parse(idle.cursor)).toEqual({ uidValidity: "4242", lastUid: 4 });
  });

  it("re-baselines when the UIDVALIDITY changes", async () => {
    const staleCursor = JSON.stringify({ uidValidity: "9999", lastUid: 2 });
    const client = new FakeImapClient([OLD_MESSAGE, REPLY_MESSAGE, HTML_MESSAGE]);
    const result = await sourceFor(client).fetchNewMessages(ACCOUNT, staleCursor);
    // Treated as a first sync: the old message stays out, recent mail in.
    expect(result.messages.map((m) => m.providerMessageId)).toEqual([
      "reply-1@mail.example.com",
      "html-1@mail.example.com",
    ]);
    expect(JSON.parse(result.cursor)).toEqual({ uidValidity: "4242", lastUid: 3 });
  });

  it("refuses to run when IMAP is not configured on the credentials", async () => {
    const source = new ImapSource({ ...CREDS, imap: null });
    await expect(source.fetchNewMessages(ACCOUNT, null)).rejects.toThrow(/IMAP is not configured/);
  });
});
