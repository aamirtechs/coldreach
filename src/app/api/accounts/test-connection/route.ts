import { NextResponse } from "next/server";
import { apiError, readJson, requireSession, stringField } from "@/lib/api";
import { parseMailboxInput } from "@/lib/accounts/mailboxInput";
import { testMailboxConnection } from "@/lib/accounts/testConnection";

/**
 * Live connection test for unsaved mailbox settings (cPanel or any
 * SMTP / IMAP mail server). The form posts the fields before saving;
 * the route verifies SMTP and IMAP separately and answers with a
 * per protocol result. The password is used only for the two login
 * attempts: it is never stored, logged, or echoed in the response.
 */
export async function POST(request: Request) {
  const session = await requireSession("ADMIN");
  if ("error" in session) return session.error;
  const body = await readJson<{
    email?: unknown;
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

  const fallbackEmail = stringField(body.email) || stringField(body.username);
  const parsed = parseMailboxInput(body, fallbackEmail);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  try {
    const results = await testMailboxConnection(parsed.credentials);
    return NextResponse.json(results);
  } catch (error) {
    return apiError(error);
  }
}
