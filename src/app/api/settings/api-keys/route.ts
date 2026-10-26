import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, readJson, requireSession, stringField } from "@/lib/api";
import { API_SCOPES, createApiKey, isApiScope, scopesOf, type ApiScope } from "@/lib/apiKeys/keys";
import { writeAuditLog } from "@/lib/audit";

/**
 * API key management (session API, ADMIN and above). The full key is
 * returned exactly once, in the create response; afterwards only the
 * prefix, scopes, and usage metadata exist anywhere.
 */
export async function GET() {
  const session = await requireSession("ADMIN");
  if ("error" in session) return session.error;
  const { ctx } = session;
  try {
    const keys = await prisma.apiKey.findMany({
      where: { workspaceId: ctx.workspace.id },
      orderBy: { createdAt: "desc" },
      include: { createdBy: { select: { name: true, email: true } } },
    });
    return NextResponse.json({
      keys: keys.map((key) => ({
        id: key.id,
        name: key.name,
        prefix: key.prefix,
        scopes: scopesOf(key),
        lastUsedAt: key.lastUsedAt,
        revokedAt: key.revokedAt,
        createdAt: key.createdAt,
        createdBy: key.createdBy,
      })),
      availableScopes: API_SCOPES,
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  const session = await requireSession("ADMIN");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const body = await readJson<{ name?: unknown; scopes?: unknown }>(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const name = stringField(body.name);
  if (!name) return NextResponse.json({ error: "A name for the key is required" }, { status: 400 });
  if (!Array.isArray(body.scopes) || body.scopes.length === 0) {
    return NextResponse.json(
      { error: `scopes must be a non-empty array chosen from: ${API_SCOPES.join(", ")}` },
      { status: 400 },
    );
  }
  const scopes: ApiScope[] = [];
  for (const value of body.scopes) {
    const scope = String(value);
    if (!isApiScope(scope)) {
      return NextResponse.json({ error: `Unknown scope "${scope}"` }, { status: 400 });
    }
    if (!scopes.includes(scope)) scopes.push(scope);
  }
  try {
    const { record, fullKey } = await createApiKey(prisma, {
      workspaceId: ctx.workspace.id,
      name,
      scopes,
      createdById: ctx.user.id,
    });
    await writeAuditLog({
      action: "apikey.create",
      userId: ctx.user.id,
      workspaceId: ctx.workspace.id,
      metadata: { apiKeyId: record.id, name: record.name, scopes },
    });
    return NextResponse.json(
      {
        key: {
          id: record.id,
          name: record.name,
          prefix: record.prefix,
          scopes,
          createdAt: record.createdAt,
        },
        // Shown exactly once. It is never stored or retrievable again.
        fullKey,
      },
      { status: 201 },
    );
  } catch (error) {
    return apiError(error);
  }
}
