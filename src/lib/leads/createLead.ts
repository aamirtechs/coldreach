import type { Lead, PrismaClient } from "@prisma/client";
import { isValidEmail, normalizeEmail } from "@/lib/domain/dedupe";
import { findSuppression } from "@/lib/domain/suppression";
import { loadSuppressions } from "@/lib/suppressions";

/**
 * Single lead creation, shared by the session API (POST /api/leads)
 * and the public API (POST /api/v1/leads) so both enforce identical
 * rules: email syntax is validated and normalised, an in-workspace
 * duplicate is refused (409), and, when rejectSuppressed is set, an
 * address matching the workspace or global suppression list is
 * refused (422) rather than created in a state that can never send.
 * The session API keeps its historical behaviour (the lead is
 * created and shown as suppressed in the UI); the public API opts
 * into rejection because an integrator cannot see that UI state.
 */

export interface CreateLeadInput {
  email: string;
  listId?: string | null;
  fields?: Record<string, unknown> | null;
  /** Convenience top-level attributes, merged into fields when the
   *  same key is not already present there. */
  firstName?: unknown;
  lastName?: unknown;
  company?: unknown;
  tags?: unknown[] | null;
  rejectSuppressed?: boolean;
}

function httpError(message: string, status: number): Error {
  return Object.assign(new Error(message), { status });
}

export function sanitizeLeadFields(input: {
  fields?: Record<string, unknown> | null;
  firstName?: unknown;
  lastName?: unknown;
  company?: unknown;
}): Record<string, string> {
  const fields: Record<string, string> = {};
  if (input.fields && typeof input.fields === "object" && !Array.isArray(input.fields)) {
    for (const [key, value] of Object.entries(input.fields)) {
      if (value !== null && value !== undefined && String(value).trim() !== "") {
        fields[key] = String(value);
      }
    }
  }
  for (const key of ["firstName", "lastName", "company"] as const) {
    const value = input[key];
    if (typeof value === "string" && value.trim() && !fields[key]) {
      fields[key] = value.trim();
    }
  }
  return fields;
}

export async function createLead(
  db: PrismaClient,
  workspaceId: string,
  input: CreateLeadInput,
): Promise<Lead> {
  const rawEmail = typeof input.email === "string" ? input.email.trim() : "";
  if (!isValidEmail(rawEmail)) {
    throw httpError("A valid email address is required", 400);
  }
  const email = normalizeEmail(rawEmail);
  const fields = sanitizeLeadFields({
    fields: input.fields ?? undefined,
    firstName: input.firstName,
    lastName: input.lastName,
    company: input.company,
  });
  const tags = Array.isArray(input.tags)
    ? input.tags.map((t) => String(t).trim()).filter(Boolean)
    : [];

  const listId = input.listId ?? null;
  if (listId) {
    const list = await db.leadList.findFirst({
      where: { id: listId, workspaceId },
      select: { id: true },
    });
    if (!list) {
      throw httpError("List not found", 404);
    }
  }

  if (input.rejectSuppressed) {
    const suppressions = await loadSuppressions(db, workspaceId);
    const hit = findSuppression(email, suppressions);
    if (hit) {
      throw httpError(
        `This address is on the suppression list (${hit.reason}) and cannot be added as a lead.`,
        422,
      );
    }
  }

  const existing = await db.lead.findUnique({
    where: { workspaceId_email: { workspaceId, email } },
    select: { id: true },
  });
  if (existing) {
    throw httpError("A lead with this email already exists in the workspace", 409);
  }

  return db.lead.create({
    data: { workspaceId, listId, email, fields, tags, status: "NEW" },
  });
}
