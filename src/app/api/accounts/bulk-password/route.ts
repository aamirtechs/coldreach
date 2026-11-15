import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, readJson, requireSession } from "@/lib/api";
import { applyPasswordToAccounts } from "@/lib/accounts/bulkPassword";
import { writeAuditLog } from "@/lib/audit";

/**
 * One password for many mailboxes (v1.28.0): applies a single typed
 * password to the selected SMTP accounts of the caller's workspace.
 * Each account is proved with the live connection test before its
 * stored credentials are replaced; failures leave the account
 * untouched and are reported per account. The password is never
 * stored outside the per account encrypted blobs, never logged, and
 * never echoed in the response.
 */
export async function POST(request: Request) {
  const session = await requireSession("ADMIN");
  if ("error" in session) return session.error;
  const { ctx } = session;
  const body = await readJson<{ password?: unknown; accountIds?: unknown }>(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

  // The password is read verbatim, exactly as typed: never trimmed.
  if (typeof body.password !== "string" || body.password.length === 0) {
    return NextResponse.json({ error: "The mailbox password is required" }, { status: 400 });
  }
  if (!Array.isArray(body.accountIds) || body.accountIds.length === 0) {
    return NextResponse.json({ error: "Select at least one account" }, { status: 400 });
  }
  if (body.accountIds.length > 100) {
    return NextResponse.json({ error: "At most 100 accounts per request" }, { status: 400 });
  }
  const accountIds = body.accountIds.filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  if (accountIds.length !== body.accountIds.length) {
    return NextResponse.json({ error: "accountIds must all be account id strings" }, { status: 400 });
  }

  try {
    const accounts = await prisma.sendingAccount.findMany({
      where: { id: { in: accountIds }, workspaceId: ctx.workspace.id, provider: "SMTP" },
      select: { id: true, email: true, encryptedCredentials: true },
    });
    if (accounts.length !== accountIds.length) {
      return NextResponse.json(
        { error: "One or more selected accounts were not found in this workspace" },
        { status: 400 },
      );
    }
    // Keep the caller's selection order in the results.
    const byId = new Map(accounts.map((account) => [account.id, account]));
    const ordered = accountIds
      .map((id) => byId.get(id))
      .filter((account): account is (typeof accounts)[number] => account !== undefined);

    const results = await applyPasswordToAccounts(prisma, ordered, body.password);
    const connected = results.filter((result) => result.ok).length;
    await writeAuditLog({
      action: "account.bulk_password",
      userId: ctx.user.id,
      workspaceId: ctx.workspace.id,
      metadata: { attempted: results.length, connected, failed: results.length - connected },
    });
    return NextResponse.json({ results, connected, failed: results.length - connected });
  } catch (error) {
    return apiError(error);
  }
}
