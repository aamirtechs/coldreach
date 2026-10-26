import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, readJson, requireSession, stringField } from "@/lib/api";
import { isValidEmail } from "@/lib/domain/dedupe";
import { writeAuditLog } from "@/lib/audit";

export async function GET() {
  const session = await requireSession("VIEWER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  try {
    const suppressions = await prisma.suppression.findMany({
      where: { OR: [{ workspaceId: ctx.workspace.id }, { scope: "GLOBAL" }] },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    return NextResponse.json({ suppressions });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  const session = await requireSession("MEMBER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const body = await readJson<{ email?: unknown; domain?: unknown; reason?: unknown }>(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const email = stringField(body.email).toLowerCase();
  const domain = stringField(body.domain).toLowerCase().replace(/^@+/, "");
  const reason = stringField(body.reason) || "Added manually";
  if (!email && !domain) {
    return NextResponse.json({ error: "Provide an email address or a domain" }, { status: 400 });
  }
  if (email && !isValidEmail(email)) {
    return NextResponse.json({ error: "That email address is not valid" }, { status: 400 });
  }
  if (domain && !domain.includes(".")) {
    return NextResponse.json({ error: "That domain does not look valid" }, { status: 400 });
  }
  try {
    const existing = await prisma.suppression.findFirst({
      where: {
        workspaceId: ctx.workspace.id,
        scope: "WORKSPACE",
        ...(email ? { email } : { domain }),
      },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json({ error: "That entry is already suppressed" }, { status: 409 });
    }
    const suppression = await prisma.suppression.create({
      data: {
        workspaceId: ctx.workspace.id,
        scope: "WORKSPACE",
        email: email || null,
        domain: domain || null,
        reason,
      },
    });
    await writeAuditLog({
      action: "suppression.create",
      userId: ctx.user.id,
      workspaceId: ctx.workspace.id,
      metadata: { email: suppression.email, domain: suppression.domain },
    });
    return NextResponse.json({ suppression }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
