import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, intField, readJson, requireSession, stringField } from "@/lib/api";
import { isValidEmail, normalizeEmail } from "@/lib/domain/dedupe";
import { encryptMailboxCredentials, resolveSmtpConfig } from "@/lib/providers";
import { hasMailboxInput, parseMailboxInput } from "@/lib/accounts/mailboxInput";
import { toPublicSendingAccount } from "@/lib/accounts/serialize";
import { withinAccountLimit } from "@/lib/domain/plans";
import { getPlanForWorkspace, getWorkspaceUsage } from "@/lib/billing/subscription";
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
        hasStoredCredentials: account.encryptedCredentials !== null,
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
    smtpHost?: unknown;
    smtpPort?: unknown;
    smtpSecure?: unknown;
    imapHost?: unknown;
    imapPort?: unknown;
    imapSecure?: unknown;
    username?: unknown;
    password?: unknown;
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
    // Plan limit (Phase 4): the workspace's plan caps sending accounts.
    const [plan, usage] = await Promise.all([
      getPlanForWorkspace(prisma, ctx.workspace.id),
      getWorkspaceUsage(prisma, ctx.workspace.id),
    ]);
    if (!withinAccountLimit(plan, usage.sendingAccounts)) {
      return NextResponse.json(
        {
          error: `The ${plan.name} plan allows ${plan.sendingAccounts} sending accounts and this workspace already has ${usage.sendingAccounts}. Upgrade in Billing to add more.`,
        },
        { status: 403 },
      );
    }
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
    let storedCredentialRef: string | null = credentialRef;
    let encryptedCredentials: string | null = null;
    if (provider === "SIMULATION") {
      // Demo accounts are immediately usable and their every result is
      // labelled DEMO in the product.
      status = "CONNECTED";
      warmupStatus = "SIMULATED";
    } else if (provider === "SMTP") {
      if (hasMailboxInput(body)) {
        // User managed mailbox (cPanel or any mail server): the owner
        // typed the settings and password, which are stored only as
        // an AES-256-GCM encrypted blob. This path and the legacy
        // credentialRef path are alternatives, never both.
        if (credentialRef) {
          return NextResponse.json(
            {
              error:
                "Choose one credential style for an SMTP account: mailbox fields or a credentialRef, not both.",
            },
            { status: 400 },
          );
        }
        const parsed = parseMailboxInput(body, normalizeEmail(rawEmail));
        if (!parsed.ok) {
          return NextResponse.json({ error: parsed.error }, { status: 400 });
        }
        encryptedCredentials = encryptMailboxCredentials(parsed.credentials);
        storedCredentialRef = null;
        status = "CONNECTED";
      } else {
        if (!credentialRef) {
          return NextResponse.json(
            {
              error:
                "SMTP accounts require either the mailbox fields (host, username, password) or a credentialRef naming the server environment prefix",
            },
            { status: 400 },
          );
        }
        if (resolveSmtpConfig(credentialRef)) {
          status = "CONNECTED";
        } else {
          lastError =
            "SMTP environment variables for this credentialRef are not set on the server yet.";
        }
      }
    } else {
      lastError = `${provider} accounts connect through the OAuth flow. The account is saved but cannot send until that flow completes.`;
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
        credentialRef: storedCredentialRef,
        encryptedCredentials,
        lastError,
      },
    });
    await writeAuditLog({
      action: "account.create",
      userId: ctx.user.id,
      workspaceId: ctx.workspace.id,
      metadata: { accountId: account.id, provider: account.provider },
    });
    // The response goes through the serializer: the encrypted blob
    // and any password never leave the server.
    return NextResponse.json({ account: toPublicSendingAccount(account) }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
