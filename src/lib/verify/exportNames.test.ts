import { describe, expect, it } from "vitest";
import { exportBaseName, verificationExportFileName } from "./exportNames";

describe("verification export file names", () => {
  it("names the good export after the imported file", () => {
    expect(verificationExportFileName("good", "back-office-emails.csv")).toBe(
      "verified-good-back-office-emails.csv",
    );
  });

  it("names every report kind after the imported file", () => {
    expect(verificationExportFileName("risky", "back-office-emails.csv")).toBe(
      "verified-risky-back-office-emails.csv",
    );
    expect(verificationExportFileName("bad", "back-office-emails.csv")).toBe(
      "verified-bad-back-office-emails.csv",
    );
    expect(verificationExportFileName("unknown", "back-office-emails.csv")).toBe(
      "verified-unknown-back-office-emails.csv",
    );
    expect(verificationExportFileName("full", "back-office-emails.csv")).toBe(
      "verified-full-back-office-emails.csv",
    );
  });

  it("normalises spaces, underscores and case in the source name", () => {
    expect(exportBaseName("Back Office_Emails.CSV")).toBe("back-office-emails");
    expect(exportBaseName("  My  Leads (final).csv")).toBe("my-leads-final");
  });

  it("falls back to a plain base when there is no source file", () => {
    expect(verificationExportFileName("good", null)).toBe("verified-good-emails.csv");
    expect(verificationExportFileName("full", "")).toBe("verified-full-emails.csv");
    expect(exportBaseName("...csv")).toBe("emails");
  });
});
