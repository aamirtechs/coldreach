import { describe, expect, it } from "vitest";
import {
  NAME_SPEECH_RATE,
  greetingNameForFields,
  greetingUtteranceText,
  nameUtteranceText,
  pickEnUsVoice,
  spokenNameForFields,
  type VoiceLike,
} from "./pronunciation";

describe("nameUtteranceText", () => {
  it("speaks the name only, trimmed, with the role note stripped", () => {
    expect(nameUtteranceText("  Anna Handy (founder, sole practitioner) ")).toBe("Anna Handy");
    expect(nameUtteranceText("Leonard Desir")).toBe("Leonard Desir");
    expect(nameUtteranceText("Amy   Smith")).toBe("Amy Smith");
  });

  it("returns empty text when there is no name", () => {
    expect(nameUtteranceText("")).toBe("");
    expect(nameUtteranceText("   ")).toBe("");
    expect(nameUtteranceText(null)).toBe("");
    expect(nameUtteranceText(undefined)).toBe("");
  });
});

describe("greetingUtteranceText", () => {
  it("builds the greeting line the caller opens with", () => {
    expect(greetingUtteranceText("Anna")).toBe("Hi, is that Anna?");
    expect(greetingUtteranceText(" Leonard ")).toBe("Hi, is that Leonard?");
  });

  it("returns empty text without a first name", () => {
    expect(greetingUtteranceText("")).toBe("");
    expect(greetingUtteranceText(null)).toBe("");
  });
});

describe("spokenNameForFields and greetingNameForFields", () => {
  it("prefers the first and last name fields over the decision maker text", () => {
    const fields = { firstName: "Leonard", lastName: "Desir", decisionMaker: "Someone Else" };
    expect(spokenNameForFields(fields)).toBe("Leonard Desir");
  });

  it("falls back to the decision maker, role note stripped", () => {
    expect(spokenNameForFields({ decisionMaker: "Austin Arnow (owner)" })).toBe("Austin Arnow");
    expect(spokenNameForFields({ firstName: "Adam", decisionMaker: "Adam Campbell" })).toBe(
      "Adam Campbell",
    );
  });

  it("reads the greeting name from firstName only", () => {
    expect(greetingNameForFields({ firstName: "Amy" })).toBe("Amy");
    expect(greetingNameForFields({ firstName: 42 })).toBe("");
    expect(greetingNameForFields(null)).toBe("");
    expect(spokenNameForFields(null)).toBe("");
  });
});

describe("pickEnUsVoice", () => {
  const voices: VoiceLike[] = [
    { lang: "en-GB", name: "Daniel" },
    { lang: "en-US", name: "Microsoft David" },
    { lang: "en-US", name: "Google US English" },
    { lang: "fr-FR", name: "Thomas" },
  ];

  it("prefers a Google en-US voice when Chrome offers one", () => {
    expect(pickEnUsVoice(voices)?.name).toBe("Google US English");
  });

  it("takes any en-US voice, then any English voice", () => {
    expect(pickEnUsVoice(voices.slice(0, 2))?.name).toBe("Microsoft David");
    expect(pickEnUsVoice([voices[0], voices[3]])?.name).toBe("Daniel");
  });

  it("falls back to the default voice, then null on an empty list", () => {
    expect(pickEnUsVoice([{ lang: "fr-FR", name: "Thomas", default: true }])?.name).toBe("Thomas");
    expect(pickEnUsVoice([{ lang: "fr-FR", name: "Thomas" }])).toBeNull();
    expect(pickEnUsVoice([])).toBeNull();
  });

  it("keeps the spoken name slow enough to copy", () => {
    expect(NAME_SPEECH_RATE).toBe(0.85);
  });
});
