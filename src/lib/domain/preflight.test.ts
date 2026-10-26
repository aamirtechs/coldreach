import { describe, expect, it } from "vitest";
import { runPreflight, type PreflightInput } from "./preflight";

function baseInput(overrides: Partial<PreflightInput> = {}): PreflightInput {
  return {
    steps: [
      { subject: "Hi {{firstName|there}}", body: "Hello from us, about {{company}}." },
      { subject: "Following up", body: "Just checking in." },
    ],
    enrolledCount: 120,
    suppressedEnrolledCount: 0,
    accounts: [
      { id: "a1", email: "a@example.com", status: "CONNECTED", effectiveDailyLimit: 100 },
      { id: "a2", email: "b@example.com", status: "CONNECTED", effectiveDailyLimit: 100 },
    ],
    availableFields: ["email", "firstName", "company"],
    unsubscribeConfigured: true,
    senderIdentity: { displayName: "Acme Outreach", postalAddress: "1 Market Street" },
    projectedDailyVolume: 120,
    ...overrides,
  };
}

function check(result: ReturnType<typeof runPreflight>, id: string) {
  const found = result.checks.find((c) => c.id === id);
  if (!found) throw new Error(`check ${id} missing`);
  return found;
}

describe("runPreflight", () => {
  it("passes a healthy campaign and allows launch", () => {
    const result = runPreflight(baseInput());
    expect(result.canLaunch).toBe(true);
    expect(result.status).toBe("pass");
  });

  it("fails when there are no steps", () => {
    const result = runPreflight(baseInput({ steps: [] }));
    expect(result.canLaunch).toBe(false);
    expect(check(result, "steps").status).toBe("fail");
  });

  it("fails when any step body is empty", () => {
    const result = runPreflight(
      baseInput({ steps: [{ subject: "Hi", body: "  " }] }),
    );
    expect(check(result, "steps").status).toBe("fail");
    expect(result.canLaunch).toBe(false);
  });

  it("warns but allows launch when a subject is empty", () => {
    const result = runPreflight(baseInput({ steps: [{ subject: "", body: "Body text" }] }));
    expect(check(result, "subjects").status).toBe("warn");
    expect(result.canLaunch).toBe(true);
    expect(result.status).toBe("warn");
  });

  it("fails with zero enrolled leads", () => {
    const result = runPreflight(baseInput({ enrolledCount: 0 }));
    expect(check(result, "audience").status).toBe("fail");
    expect(result.canLaunch).toBe(false);
  });

  it("fails with no sending accounts", () => {
    const result = runPreflight(baseInput({ accounts: [] }));
    expect(check(result, "accounts").status).toBe("fail");
  });

  it("fails when accounts exist but none is connected", () => {
    const result = runPreflight(
      baseInput({
        accounts: [{ id: "a1", email: "a@example.com", status: "DISCONNECTED", effectiveDailyLimit: 50 }],
      }),
    );
    expect(check(result, "accounts").status).toBe("fail");
  });

  it("fails on template tokens with no lead field and no fallback", () => {
    const result = runPreflight(
      baseInput({ steps: [{ subject: "Hi", body: "Your role is {{jobTitle}} at {{company}}." }] }),
    );
    expect(check(result, "tokens").status).toBe("fail");
    expect(check(result, "tokens").message).toContain("jobTitle");
    expect(result.canLaunch).toBe(false);
  });

  it("passes tokens that resolve from fields or fallbacks", () => {
    const result = runPreflight(
      baseInput({
        availableFields: ["email", "firstName"],
        steps: [{ subject: "Hi {{nickname|friend}}", body: "{{firstName}} at {{company|your company}}" }],
      }),
    );
    expect(check(result, "tokens").status).toBe("pass");
  });

  it("fails when the unsubscribe mechanism is not configured", () => {
    const result = runPreflight(baseInput({ unsubscribeConfigured: false }));
    expect(check(result, "unsubscribe").status).toBe("fail");
    expect(result.canLaunch).toBe(false);
  });

  it("warns when enrolled leads are suppressed", () => {
    const result = runPreflight(baseInput({ suppressedEnrolledCount: 3 }));
    expect(check(result, "suppressed").status).toBe("warn");
    expect(result.canLaunch).toBe(true);
  });

  it("warns when projected volume exceeds combined effective limits", () => {
    const result = runPreflight(baseInput({ projectedDailyVolume: 5000 }));
    expect(check(result, "capacity").status).toBe("warn");
    expect(result.canLaunch).toBe(true);
  });

  it("passes capacity when projected volume fits", () => {
    const result = runPreflight(baseInput({ projectedDailyVolume: 80 }));
    expect(check(result, "capacity").status).toBe("pass");
  });

  it("warns when the sender identity is incomplete", () => {
    const result = runPreflight(
      baseInput({ senderIdentity: { displayName: null, postalAddress: null } }),
    );
    expect(check(result, "identity").status).toBe("warn");
  });
});
