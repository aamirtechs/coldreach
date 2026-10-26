import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSessionWorkspace } from "@/lib/auth/session";
import { findInviteByToken, inviteState } from "@/lib/team/invites";
import { InviteAccept } from "@/components/team/InviteAccept";

export const dynamic = "force-dynamic";

/**
 * Invitation landing page. Works logged out (it names the workspace,
 * the invited email, and the role, and routes the invitee to signup or
 * login) and logged in (one click joins). Only the token hash is ever
 * stored, so this page performs the same lookup the accept API does.
 */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await findInviteByToken(prisma, token);
  const session = await getSessionWorkspace();

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-10">
      <p className="font-display text-sm font-bold tracking-tight">ColdReach</p>
      {!invite ? (
        <section className="card mt-4 p-6">
          <h1 className="font-display text-xl font-semibold">Invitation not found</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            This link is not valid. It may have been revoked, or resent with a fresh link that
            replaced it. Ask the workspace owner for a new invitation.
          </p>
          <Link href="/login" className="btn-secondary mt-5 inline-flex">Go to sign in</Link>
        </section>
      ) : (
        <section className="card mt-4 p-6">
          <h1 className="font-display text-xl font-semibold">
            Join {invite.workspace.name} on ColdReach
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            You were invited as <strong>{invite.role}</strong> with the email{" "}
            <strong>{invite.email}</strong>.
          </p>
          {inviteState(invite) === "EXPIRED" ? (
            <p className="mt-3 text-sm text-warning">
              This invitation has expired. Ask the workspace owner to resend it.
            </p>
          ) : inviteState(invite) === "ACCEPTED" ? (
            <p className="mt-3 text-sm text-muted">
              This invitation was already accepted. If that was you, the workspace is in your
              switcher in the top bar after signing in.
            </p>
          ) : session ? (
            <>
              <p className="mt-3 text-sm text-muted">
                You are signed in as {session.user.email}. Accepting joins the workspace with
                the invited role and switches you into it.
              </p>
              <div className="mt-5">
                <InviteAccept token={token} />
              </div>
            </>
          ) : (
            <>
              <p className="mt-3 text-sm text-muted">
                Sign in, or create an account with the invited email address, then open this
                link again to accept.
              </p>
              <div className="mt-5 flex gap-3">
                <Link href="/login" className="btn-primary">Sign in</Link>
                <Link href="/signup" className="btn-secondary">Create account</Link>
              </div>
            </>
          )}
        </section>
      )}
    </main>
  );
}
