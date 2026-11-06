import { describe, expect, it } from "vitest";
import {
  attachmentContentType,
  formatBytes,
  MAX_ATTACHMENT_BYTES,
  sanitizeFilename,
  validateAttachment,
} from "./attachments";

describe("attachmentContentType", () => {
  it("maps document, image, and text formats to content types", () => {
    expect(attachmentContentType("deck.pdf")).toBe("application/pdf");
    expect(attachmentContentType("notes.DOCX")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(attachmentContentType("photo.Jpeg")).toBe("image/jpeg");
    expect(attachmentContentType("list.csv")).toBe("text/csv");
  });

  it("rejects executables, scripts, archives, and extensionless files", () => {
    expect(attachmentContentType("setup.exe")).toBeNull();
    expect(attachmentContentType("script.js")).toBeNull();
    expect(attachmentContentType("bundle.zip")).toBeNull();
    expect(attachmentContentType("noextension")).toBeNull();
    expect(attachmentContentType("trailingdot.")).toBeNull();
  });
});

describe("validateAttachment", () => {
  it("accepts an allowed file under the 1 MB cap", () => {
    const result = validateAttachment({ filename: "one-pager.pdf", sizeBytes: 500_000, existingCount: 0 });
    expect(result).toEqual({ ok: true, filename: "one-pager.pdf", contentType: "application/pdf" });
  });

  it("accepts a file of exactly 1 MB", () => {
    const result = validateAttachment({
      filename: "big.png",
      sizeBytes: MAX_ATTACHMENT_BYTES,
      existingCount: 2,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a file one byte over 1 MB", () => {
    const result = validateAttachment({
      filename: "big.png",
      sizeBytes: MAX_ATTACHMENT_BYTES + 1,
      existingCount: 0,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("1 MB");
    }
  });

  it("rejects empty files and disallowed types", () => {
    expect(validateAttachment({ filename: "a.pdf", sizeBytes: 0, existingCount: 0 }).ok).toBe(false);
    expect(validateAttachment({ filename: "a.exe", sizeBytes: 10, existingCount: 0 }).ok).toBe(false);
  });

  it("rejects a fourth attachment on one step", () => {
    const result = validateAttachment({ filename: "a.pdf", sizeBytes: 10, existingCount: 3 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("maximum per step");
    }
  });
});

describe("sanitizeFilename", () => {
  it("strips path components", () => {
    expect(sanitizeFilename("../../etc/evil.pdf")).toBe("evil.pdf");
    expect(sanitizeFilename("C:\\Users\\x\\report.docx")).toBe("report.docx");
  });

  it("keeps the extension when truncating a long name", () => {
    const long = `${"a".repeat(250)}.pdf`;
    const cleaned = sanitizeFilename(long);
    expect(cleaned.length).toBe(200);
    expect(cleaned.endsWith(".pdf")).toBe(true);
  });
});

describe("formatBytes", () => {
  it("formats bytes, KB, and MB", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(MAX_ATTACHMENT_BYTES)).toBe("1.0 MB");
  });
});
