import { describe, expect, it } from "vitest";
import { findSuppression, isSuppressed, type SuppressionEntry } from "./suppression";

const entries: SuppressionEntry[] = [
  { scope: "WORKSPACE", email: "angry.customer@example.com", reason: "Complaint" },
  { scope: "GLOBAL", domain: "blocked-domain.test", reason: "Known spam source" },
  { scope: "WORKSPACE", domain: "@opted-out.example", reason: "Company wide opt out" },
];

describe("isSuppressed", () => {
  it("matches an exact email entry case-insensitively", () => {
    expect(isSuppressed("Angry.Customer@Example.com", entries)).toBe(true);
  });

  it("matches a global domain entry for any mailbox at that domain", () => {
    expect(isSuppressed("anyone@blocked-domain.test", entries)).toBe(true);
  });

  it("matches a domain entry written with a leading @", () => {
    expect(isSuppressed("person@opted-out.example", entries)).toBe(true);
  });

  it("does not match a subdomain of a suppressed domain", () => {
    expect(isSuppressed("person@mail.blocked-domain.test", entries)).toBe(false);
  });

  it("returns false for an address with no matching entry", () => {
    expect(isSuppressed("prospect@normal-company.com", entries)).toBe(false);
    expect(isSuppressed("prospect@normal-company.com", [])).toBe(false);
  });

  it("exposes the matching entry so callers can report the reason and scope", () => {
    const match = findSuppression("x@blocked-domain.test", entries);
    expect(match?.scope).toBe("GLOBAL");
    expect(match?.reason).toBe("Known spam source");
  });
});
