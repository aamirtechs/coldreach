import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, readJson, stringField } from "@/lib/api";
import { requireApiKey } from "@/lib/apiKeys/auth";
import { isValidEmail, normalizeEmail } from "@/lib/domain/dedupe";

/**
 * Public API: add a workspace suppression by email or domain.
 * Idempotent: re-adding an existing entry returns the existing row
 * with created=false instead of an error.
 */
export async function POST(request: Request) {
  const auth = await requireApiKey(request, "suppressions:write");
  if ("error" in auth) return auth.error;
  const { ctx } = auth;
  const body = await readJson<{ email?: unknown; domain?: unknown; reason?: unknown }>(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const email = stringField(body.email);
  const domain = stringField(body.domain).toLowerCase().replace(/^@/, "");
  const reason = stringField(body.reason) || "Added through the public API";
  if (!email && !domain) {
    return NextResponse.json({ error: "Provide an email or a domain" }, { status: 400 });
  }
  if (email && !isValidEmail(email)) {
    return NextResponse.json({ error: "The email address is not valid" }, { status: 400 });
  }
  if (domain && !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) {
    return NextResponse.json({ error: "The domain is not valid" }, { status: 400 });
  }
  try {
    const where = email
      ? { workspaceId: ctx.workspaceId, scope: "WORKSPACE" as const, email: normalizeEmail(email) }
      : { workspaceId: ctx.workspaceId, scope: "WORKSPACE" as const, domain };
    const existing = await prisma.suppression.findFirst({ where });
    if (existing) {
      return NextResponse.json({ suppression: existing, created: false });
    }
    const suppression = await prisma.suppression.create({
      data: {
        workspaceId: ctx.workspaceId,
        scope: "WORKSPACE",
        email: email ? normalizeEmail(email) : null,
        domain: email ? null : domain,
        reason,
      },
    });
    return NextResponse.json({ suppression, created: true }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
