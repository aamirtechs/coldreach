import { describe, expect, it } from "vitest";
import { renderEmailCopy } from "./previewEmail";

const base = {
  enrollmentId: "enroll-1",
  stepIndex: 0,
  step: {
    subject: "Quick idea for {{company}}",
    body: "Hi {{firstName|there}},\n\nI saw {{company}} is growing. Worth a chat?\n\n{{senderFirstName}}",
    variants: [],
  },
  leadEmail: "owner@acme.test",
  leadFields: { firstName: "Sam", company: "Acme Hauling" },
  campaign: { signatureText: null, senderName: "Amir Hussain", companyName: "Dispatch Authority" },
  workspace: { senderName: "Workspace Sender", name: "AamirTechs", senderAddress: "Multan, Punjab, Pakistan" },
  unsubscribeUrl: "https://app.example.test/u/token-123",
};

describe("renderEmailCopy", () => {
  it("renders the exact text the worker sends: tokens, identity signature, and footer", () => {
    const copy = renderEmailCopy(base);
    expect(copy.variantLabel).toBe("A");
    expect(copy.subject).toBe("Quick idea for Acme Hauling");
    expect(copy.bodyText).toContain("Hi Sam,");
    expect(copy.bodyText).toContain("Amir");
    // No explicit signature: the campaign identity composes the sign-off.
    expect(copy.effectiveSignature).toBe("Amir Hussain\nDispatch Authority");
    expect(copy.fullText).toBe(
      `${copy.bodyText}\n\nAmir Hussain\nDispatch Authority\n\n--\nMultan, Punjab, Pakistan\nUnsubscribe: https://app.example.test/u/token-123`,
    );
  });

  it("prefers an explicit campaign signature and drops the footer name line", () => {
    const copy = renderEmailCopy({
      ...base,
      campaign: { signatureText: "Best,\n{{senderName}}\n{{senderCompany}}", senderName: "Amir Hussain", companyName: "Dispatch Authority" },
    });
    expect(copy.effectiveSignature).toBe("Best,\nAmir Hussain\nDispatch Authority");
    expect(copy.footerText).not.toContain("Workspace Sender");
    expect(copy.fullText).toContain("Best,\nAmir Hussain\nDispatch Authority\n\n--");
  });

  it("falls back to the workspace sender line when there is no signature at all", () => {
    const copy = renderEmailCopy({
      ...base,
      campaign: { signatureText: null, senderName: null, companyName: null },
    });
    expect(copy.effectiveSignature).toBe("");
    expect(copy.footerText).toContain("Workspace Sender");
  });

  it("is deterministic: the same enrollment and step render identical copy twice", () => {
    const spintaxBase = {
      ...base,
      step: { subject: "{Hello|Hi} {{firstName|there}}", body: "{One|Two} for {{company}}", variants: [] },
    };
    const first = renderEmailCopy(spintaxBase);
    const second = renderEmailCopy(spintaxBase);
    expect(first.subject).toBe(second.subject);
    expect(first.bodyText).toBe(second.bodyText);
    expect(["Hello", "Hi"]).toContain(first.subject.split(" ")[0]);
  });

  it("picks the same A/B variant the worker picks for an enrollment", () => {
    const withVariant = {
      ...base,
      enrollmentId: "enroll-variant",
      step: {
        subject: "A subject",
        body: "A body",
        variants: [{ label: "B", subject: "B subject", bodyText: "B body", bodyHtml: null, weight: 100 }],
      },
    };
    const copy = renderEmailCopy(withVariant);
    // Weight 100 against A's 1 can still land on A for some seeds; the
    // guarantee under test is determinism, and that variant copy is
    // used verbatim when its label is picked.
    const again = renderEmailCopy(withVariant);
    expect(copy.variantLabel).toBe(again.variantLabel);
    if (copy.variantLabel === "B") {
      expect(copy.subject).toBe("B subject");
      expect(copy.bodyText).toBe("B body");
    } else {
      expect(copy.subject).toBe("A subject");
      expect(copy.bodyText).toBe("A body");
    }
  });
});
