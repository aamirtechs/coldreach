/**
 * Per-step campaign attachments (v1.19.0): the pure rules every
 * attachment path shares, kept free of database and HTTP concerns so
 * they are unit testable and identical in the API, the preflight
 * service, and the UI copy.
 *
 * Amir's hard rule: no file larger than 1 MB. The allowlist is the
 * security boundary: only document, spreadsheet, presentation, image,
 * and plain text formats can be attached, never executables, scripts,
 * archives, or anything a mail filter would treat as a payload. The
 * content type is derived from the file extension on the server, never
 * trusted from the client.
 */

export const MAX_ATTACHMENT_BYTES = 1024 * 1024;
export const MAX_ATTACHMENTS_PER_STEP = 3;
export const MAX_FILENAME_LENGTH = 200;

const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  txt: "text/plain",
  csv: "text/csv",
};

export const ALLOWED_ATTACHMENT_EXTENSIONS = Object.keys(CONTENT_TYPE_BY_EXTENSION);

/** Extension of a filename, lowercased, without the dot ("" when none). */
export function attachmentExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0 || dot === filename.length - 1) {
    return "";
  }
  return filename.slice(dot + 1).toLowerCase();
}

/** The server side content type for a filename, or null when not allowed. */
export function attachmentContentType(filename: string): string | null {
  return CONTENT_TYPE_BY_EXTENSION[attachmentExtension(filename)] ?? null;
}

/**
 * Strips any path components and control characters from a client
 * supplied filename and caps its length, keeping the extension.
 */
export function sanitizeFilename(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f\u007f"]/g, "").trim();
  if (cleaned.length <= MAX_FILENAME_LENGTH) {
    return cleaned;
  }
  const extension = attachmentExtension(cleaned);
  const suffix = extension ? `.${extension}` : "";
  return cleaned.slice(0, MAX_FILENAME_LENGTH - suffix.length) + suffix;
}

export type AttachmentValidation =
  | { ok: true; filename: string; contentType: string }
  | { ok: false; error: string };

/**
 * Validates one proposed upload against the size cap, the per-step
 * count cap, and the format allowlist. `existingCount` is how many
 * attachments the step already carries.
 */
export function validateAttachment(input: {
  filename: string;
  sizeBytes: number;
  existingCount: number;
}): AttachmentValidation {
  const filename = sanitizeFilename(input.filename);
  if (!filename) {
    return { ok: false, error: "The uploaded file has no usable filename." };
  }
  const contentType = attachmentContentType(filename);
  if (!contentType) {
    return {
      ok: false,
      error: `"${filename}" is not an allowed attachment type. Allowed: PDF, Word, Excel, PowerPoint, PNG, JPG, GIF, WebP, TXT, CSV.`,
    };
  }
  if (!Number.isFinite(input.sizeBytes) || input.sizeBytes <= 0) {
    return { ok: false, error: `"${filename}" is empty.` };
  }
  if (input.sizeBytes > MAX_ATTACHMENT_BYTES) {
    return {
      ok: false,
      error: `"${filename}" is ${formatBytes(input.sizeBytes)}. Attachments are limited to 1 MB per file.`,
    };
  }
  if (input.existingCount >= MAX_ATTACHMENTS_PER_STEP) {
    return {
      ok: false,
      error: `This step already has ${MAX_ATTACHMENTS_PER_STEP} attachments, the maximum per step. Remove one before adding another.`,
    };
  }
  return { ok: true, filename, contentType };
}

/** Human readable size, for example "812 KB" or "1.0 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
