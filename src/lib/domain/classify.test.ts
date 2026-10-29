import { describe, expect, it } from "vitest";
import { classifyReply, isAutomatedReply, isReplyClassification, REPLY_CLASSIFICATIONS } from "./classify";

describe("classifyReply", () => {
  it("classifies an out of office auto-reply, even with positive filler", () => {
    expect(
      classifyReply(
        "Automatic reply: Out of office",
        "I am currently out of the office on vacation and will be back on Monday. I am interested in catching up then.",
      ),
    ).toBe("OUT_OF_OFFICE");
  });

  it("classifies an unsubscribe demand as NEGATIVE", () => {
    expect(classifyReply("Re: Hello", "Please unsubscribe me and remove me from your list.")).toBe("NEGATIVE");
  });

  it("lets a negative win over polite positive filler", () => {
    expect(
      classifyReply("Re: Hello", "Thanks, sounds good in principle, but we are not interested. Please stop emailing us."),
    ).toBe("NEGATIVE");
  });

  it("classifies a polite rejection as NEGATIVE", () => {
    expect(classifyReply("Re: Intro", "Appreciate the note, but this is not a fit for us right now.")).toBe(
      "NEGATIVE",
    );
  });

  it("classifies a hand-off to a colleague as REFERRAL", () => {
    expect(
      classifyReply("Re: Intro", "I am not the right person for this. You should talk to our ops lead, Jane."),
    ).toBe("REFERRAL");
  });

  it("classifies a departed contact as REFERRAL", () => {
    expect(classifyReply("Re: Intro", "Tom has left the company. Please reach out to our team inbox instead.")).toBe(
      "REFERRAL",
    );
  });

  it("classifies explicit interest as POSITIVE", () => {
    expect(
      classifyReply("Re: Intro", "This sounds interesting. Let's set up a call next week to go over pricing."),
    ).toBe("POSITIVE");
  });

  it("classifies a plain acknowledgement as NEUTRAL", () => {
    expect(classifyReply("Re: Intro", "Got it, thanks for sending this over. I will take a look when I can.")).toBe(
      "NEUTRAL",
    );
  });

  it("classifies a question with no signal as NEUTRAL", () => {
    expect(classifyReply("Re: Intro", "Which regions do you currently cover?")).toBe("NEUTRAL");
  });

  it("handles a missing subject", () => {
    expect(classifyReply(null, "Count me in, send me details.")).toBe("POSITIVE");
    expect(classifyReply(undefined, "")).toBe("NEUTRAL");
  });
});

describe("classifyReply AUTOMATED", () => {
  const watiBody =
    "Hi Amir, Need help? Getting support is now faster and simpler than ever. Simply use the in-app help widget available in your Wati Team Inbox to chat with our AI assistant. If you need more help, a quick click on Connect with our team connects you to our support team. Alternatively, you can use our help center to contact our support team. We are here to make your experience better than ever. P.S. Please DON'T send an email to support@wati.io or billing@wati.io. Follow the mentioned steps to get help in Wati. Cheers, The Wati Team";

  it("classifies the Wati support routing message as AUTOMATED", () => {
    expect(classifyReply("Re: Support and help center for Wati", watiBody, "support@wati.io")).toBe("AUTOMATED");
  });

  it("classifies a ticket receipt as AUTOMATED", () => {
    expect(
      classifyReply(
        "Re: Help needed",
        "Thanks for contacting us. We received your request and a ticket has been created. Your ticket number is 48291.",
        "support@acme.com",
      ),
    ).toBe("AUTOMATED");
  });

  it("classifies a noreply sender with an anodyne body as AUTOMATED", () => {
    expect(
      classifyReply("Your weekly summary", "Here is a summary of activity on your account this week.", "noreply@acme.com"),
    ).toBe("AUTOMATED");
  });

  it("keeps a human positive reply that mentions support as POSITIVE", () => {
    expect(
      classifyReply(
        "Re: Intro",
        "Thanks for reaching out, this sounds interesting. Our support team has been asking for exactly this. Can you send me more information and pricing?",
        "jane@acme.com",
      ),
    ).toBe("POSITIVE");
  });

  it("keeps a human referral naming a person as REFERRAL, even though it mentions the support team", () => {
    expect(
      classifyReply(
        "Re: Intro",
        "I am not the right person for this. Talk to our support lead, Marta Chen, she owns vendor tools. I have forwarded your email to her.",
        "dan@acme.com",
      ),
    ).toBe("REFERRAL");
  });

  it("keeps an out of office reply as OUT_OF_OFFICE, even from a noreply style sender mentioning a help center", () => {
    expect(
      classifyReply(
        "Out of office",
        "I am currently out of the office on vacation. For urgent help, please visit our help center while I am away.",
        "no-reply@acme.com",
      ),
    ).toBe("OUT_OF_OFFICE");
  });

  it("does not treat a human reply from a support address with no machine signals as AUTOMATED", () => {
    expect(
      classifyReply(
        "Re: Intro",
        "Hi, I run support here and I read your note myself. We are not interested right now.",
        "support@acme.com",
      ),
    ).toBe("NEGATIVE");
  });

  it("includes AUTOMATED in the known classifications", () => {
    expect(REPLY_CLASSIFICATIONS).toContain("AUTOMATED");
    expect(isReplyClassification("AUTOMATED")).toBe(true);
  });
});

describe("isAutomatedReply", () => {
  it("treats a strong sender local part as automated on its own", () => {
    expect(isAutomatedReply("mailer-daemon@acme.com", "Notice", "Your message could not be sent.")).toBe(true);
    expect(isAutomatedReply("notifications@acme.com", "Update", "Something changed on your account.")).toBe(true);
    expect(isAutomatedReply(null, "Update", "Something changed on your account.")).toBe(false);
  });

  it("requires a body signal for support style senders", () => {
    expect(
      isAutomatedReply("support@acme.com", "Re: Intro", "Hi, I read your note myself and will get back to you."),
    ).toBe(false);
    expect(
      isAutomatedReply("helpdesk@acme.com", "Re: Intro", "Your ticket has been created. Your reference number is 991."),
    ).toBe(true);
  });

  it("detects a body signal from an ordinary sender", () => {
    expect(
      isAutomatedReply("jane@acme.com", "Re: Intro", "This is an automated message confirming your booking."),
    ).toBe(true);
    expect(isAutomatedReply("jane@acme.com", "Re: Intro", "Thanks, I will take a look this week.")).toBe(false);
  });

  it("handles missing sender and subject", () => {
    expect(isAutomatedReply(undefined, undefined, "Delivery has failed for the address you wrote to.")).toBe(true);
    expect(isAutomatedReply(undefined, null, "A perfectly ordinary note.")).toBe(false);
  });
});
