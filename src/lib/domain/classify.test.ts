import { describe, expect, it } from "vitest";
import { classifyReply } from "./classify";

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
