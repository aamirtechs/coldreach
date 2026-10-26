import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, intField, readJson, requireSession, stringField } from "@/lib/api";
import { isValidEmail, normalizeEmail } from "@/lib/domain/dedupe";
import { resolveSmtpConfig } from "@/lib/providers";
import { writeAuditLog } from "@/lib/audit";

const PROVIDERS = ["SIMULATION", "SMTP", "GMAIL", "MS365"] as const;

export async function GET() {
  const session = await requireSession("VIEWER");
  if ("error" in session) return session.error;
  const { ctx } = session;
  try {
    const accounts = await prisma.sendingAccount.findMany({
      where: { workspaceId: ctx.workspace.id },
      orderBy: { createdAt: "asc" },
    });
    return NextResponse.json({
      accounts: accounts.map((account) => ({
        id: account.id,
        email: account.email,
        displayName: account.displayName,
        provider: account.provider,
        status: account.status,
        dailyLimit: account.dailyLimit,
        warmupStatus: account.warmupStatus,
        credentialRef: account.credentialRef,
        hasOAuthTokens: account.encryptedCredentials !== null,
        tokenExpiresAt: account.tokenExpiresAt,
        lastSyncAt: account.lastSyncAt,
        providerAccountId: account.providerAccountId,
        lastError: account.lastError,
        demo: account.provider === "SIMULATION",
        createdAt: account.createdAt,
      })),
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  const session = await requireSession("ADMIN");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const body = await readJson<{
    email?: unknown;
    displayName?: unknown;
    provider?: unknown;
    dailyLimit?: unknown;
    credentialRef?: unknown;
  }>(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

  const rawEmail = stringField(body.email);
  if (!isValidEmail(rawEmail)) {
    return NextResponse.json({ error: "A valid sender email is required" }, { status: 400 });
  }
  const provider = stringField(body.provider) || "SIMULATION";
  if (!PROVIDERS.includes(provider as (typeof PROVIDERS)[number])) {
    return NextResponse.json({ error: `Unknown provider "${provider}"` }, { status: 400 });
  }
  const dailyLimit = Math.max(1, intField(body.dailyLimit, 50));
  const credentialRef = stringField(body.credentialRef) || null;

  try {
    const existing = await prisma.sendingAccount.findUnique({
      where: { workspaceId_email: { workspaceId: ctx.workspace.id, email: normalizeEmail(rawEmail) } },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json(
        { error: "An account with this email already exists in the workspace" },
        { status: 409 },
      );
    }

    let status: "CONNECTED" | "DISCONNECTED" = "DISCONNECTED";
    let warmupStatus: "OFF" | "SIMULATED" = "OFF";
    let lastError: string | null = null;
    if (provider === "SIMULATION") {
      // Demo accounts are immediately usable and their every result is
      // labelled DEMO in the product.
      status = "CONNECTED";
      warmupStatus = "SIMULATED";
    } else if (provider === "SMTP") {
      if (!credentialRef) {
        return NextResponse.json(
          { error: "SMTP accounts require a credentialRef naming the server environment prefix" },
          { status: 400 },
        );
      }
      if (resolveSmtpConfig(credentialRef)) {
        status = "CONNECTED";
      } else {
        lastError =
          "SMTP environment variables for this credentialRef are not set on the server yet.";
      }
    } else {
      lastError = `${provider} OAuth connection arrives in Phase 3. The account is saved but cannot send yet.`;
    }

    const account = await prisma.sendingAccount.create({
      data: {
        workspaceId: ctx.workspace.id,
        email: normalizeEmail(rawEmail),
        displayName: stringField(body.displayName) || null,
        provider: provider as (typeof PROVIDERS)[number],
        status,
        dailyLimit,
        warmupStatus,
        credentialRef,
        lastError,
      },
    });
    await writeAuditLog({
      action: "account.create",
      userId: ctx.user.id,
      workspaceId: ctx.workspace.id,
      metadata: { accountId: account.id, provider: account.provider },
    });
    return NextResponse.json({ account }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
