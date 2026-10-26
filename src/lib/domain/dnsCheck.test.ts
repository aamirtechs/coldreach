import { describe, expect, it } from "vitest";
import { countSpfLookups, estimateDkimKeyBits, evaluateDns, type DnsLookupResult } from "./dnsCheck";

// A 2048 bit RSA public key in DER is about 294 bytes, about 392 base64 chars.
const KEY_2048 = "A".repeat(392);
// A 1024 bit RSA public key in DER is about 162 bytes, about 216 base64 chars.
const KEY_1024 = "B".repeat(216);

function baseLookups(overrides: Partial<DnsLookupResult>): DnsLookupResult {
  return {
    rootTxtRecords: [],
    dmarcRecord: null,
    dkimRecords: { google: null, selector1: null, selector2: null, default: null },
    errors: [],
    ...overrides,
  };
}

describe("evaluateDns", () => {
  it("grades a fully configured domain highly", () => {
    const report = evaluateDns(
      "example.com",
      baseLookups({
        rootTxtRecords: ["v=spf1 include:_spf.google.com include:sendgrid.net -all"],
        dmarcRecord: "v=DMARC1; p=reject; rua=mailto:dmarc@example.com; pct=100",
        dkimRecords: {
          google: `v=DKIM1; k=rsa; p=${KEY_2048}`,
          selector1: null,
          selector2: null,
          default: null,
        },
      }),
    );
    expect(report.grade).toBe("A");
    expect(report.score).toBe(100);
    expect(report.findings.every((f) => f.status === "pass")).toBe(true);
    expect(report.dkimSelectorsFound).toEqual(["google"]);
    expect(report.spfRecord).toContain("v=spf1");
  });

  it("fails a domain with no DMARC record", () => {
    const report = evaluateDns(
      "example.com",
      baseLookups({
        rootTxtRecords: ["v=spf1 include:_spf.google.com -all"],
        dmarcRecord: null,
        dkimRecords: { google: `v=DKIM1; k=rsa; p=${KEY_2048}` },
      }),
    );
    const dmarc = report.findings.find((f) => f.check === "DMARC");
    expect(dmarc?.status).toBe("fail");
    expect(dmarc?.fix).toContain("_dmarc");
    expect(report.score).toBeLessThanOrEqual(70);
  });

  it("warns on a DMARC policy of none with no reporting address", () => {
    const report = evaluateDns(
      "example.com",
      baseLookups({
        rootTxtRecords: ["v=spf1 -all"],
        dmarcRecord: "v=DMARC1; p=none",
        dkimRecords: { google: `v=DKIM1; k=rsa; p=${KEY_2048}` },
      }),
    );
    const dmarcFindings = report.findings.filter((f) => f.check === "DMARC");
    expect(dmarcFindings.some((f) => f.status === "warn" && f.message.includes("p=none"))).toBe(true);
    expect(dmarcFindings.some((f) => f.message.includes("rua"))).toBe(true);
  });

  it("fails a weak SPF record that accepts everyone", () => {
    const report = evaluateDns(
      "example.com",
      baseLookups({
        rootTxtRecords: ["v=spf1 +all"],
        dmarcRecord: "v=DMARC1; p=reject; rua=mailto:d@example.com",
        dkimRecords: { google: `v=DKIM1; k=rsa; p=${KEY_2048}` },
      }),
    );
    const spfAll = report.findings.find((f) => f.check === "SPF" && f.message.includes("+all"));
    expect(spfAll?.status).toBe("fail");
  });

  it("warns on a soft fail SPF ending", () => {
    const report = evaluateDns(
      "example.com",
      baseLookups({
        rootTxtRecords: ["v=spf1 include:_spf.google.com ~all"],
        dmarcRecord: "v=DMARC1; p=reject; rua=mailto:d@example.com",
        dkimRecords: { google: `v=DKIM1; k=rsa; p=${KEY_2048}` },
      }),
    );
    expect(report.findings.some((f) => f.check === "SPF" && f.message.includes("~all"))).toBe(true);
  });

  it("fails when SPF has too many DNS lookups", () => {
    const includes = Array.from({ length: 11 }, (_, i) => `include:p${i}.example.net`).join(" ");
    const report = evaluateDns(
      "example.com",
      baseLookups({
        rootTxtRecords: [`v=spf1 ${includes} -all`],
        dmarcRecord: "v=DMARC1; p=reject; rua=mailto:d@example.com",
        dkimRecords: { google: `v=DKIM1; k=rsa; p=${KEY_2048}` },
      }),
    );
    expect(
      report.findings.some((f) => f.check === "SPF" && f.status === "fail" && f.message.includes("limit of 10")),
    ).toBe(true);
  });

  it("fails when two SPF records compete", () => {
    const report = evaluateDns(
      "example.com",
      baseLookups({
        rootTxtRecords: ["v=spf1 include:a.example.net -all", "v=spf1 include:b.example.net -all"],
        dmarcRecord: "v=DMARC1; p=reject; rua=mailto:d@example.com",
        dkimRecords: { google: `v=DKIM1; k=rsa; p=${KEY_2048}` },
      }),
    );
    expect(report.findings.some((f) => f.check === "SPF" && f.message.includes("exactly one"))).toBe(true);
  });

  it("reports DKIM as unknown when no selector has a record", () => {
    const report = evaluateDns(
      "example.com",
      baseLookups({
        rootTxtRecords: ["v=spf1 -all"],
        dmarcRecord: "v=DMARC1; p=reject; rua=mailto:d@example.com",
        dkimRecords: { google: null, selector1: null, selector2: null, default: null },
      }),
    );
    const dkim = report.findings.find((f) => f.check === "DKIM");
    expect(dkim?.status).toBe("unknown");
    expect(report.dkimSelectorsFound).toEqual([]);
  });

  it("warns on a weak 1024 bit DKIM key", () => {
    const report = evaluateDns(
      "example.com",
      baseLookups({
        rootTxtRecords: ["v=spf1 -all"],
        dmarcRecord: "v=DMARC1; p=reject; rua=mailto:d@example.com",
        dkimRecords: { selector1: `v=DKIM1; k=rsa; p=${KEY_1024}` },
      }),
    );
    expect(
      report.findings.some((f) => f.check === "DKIM" && f.status === "warn" && f.message.includes("1024 bit")),
    ).toBe(true);
    expect(report.dkimSelectorsFound).toEqual(["selector1"]);
  });

  it("turns DNS transport errors into unknown findings, not a crash", () => {
    const report = evaluateDns("nonexistent.invalid", baseLookups({ errors: ["ENOTFOUND"] }));
    expect(report.findings.some((f) => f.status === "unknown")).toBe(true);
    expect(report.grade).not.toBe("A");
    // A domain where nothing at all could be retrieved is unverifiable,
    // not healthy: the score is capped in the C band.
    expect(report.score).toBeLessThanOrEqual(55);
    expect(report.grade).toBe("C");
  });
});

describe("helpers", () => {
  it("counts SPF lookups", () => {
    expect(countSpfLookups("v=spf1 include:a.com include:b.com mx -all")).toBe(3);
    expect(countSpfLookups("v=spf1 ip4:1.2.3.4 -all")).toBe(0);
    expect(countSpfLookups("v=spf1 redirect=_spf.example.com")).toBe(1);
  });

  it("estimates DKIM key sizes from the base64 length", () => {
    expect(estimateDkimKeyBits(KEY_2048)).toBe(2048);
    expect(estimateDkimKeyBits(KEY_1024)).toBe(1024);
    expect(estimateDkimKeyBits("short")).toBeNull();
  });
});
