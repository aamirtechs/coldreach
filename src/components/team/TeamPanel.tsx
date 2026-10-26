"use client";

import { useCallback, useEffect, useState } from "react";

interface Member {
  userId: string;
  name: string | null;
  email: string;
  role: string;
  joinedAt: string;
  isYou: boolean;
}

interface Invite {
  id: string;
  email: string;
  role: string;
  state: "PENDING" | "ACCEPTED" | "EXPIRED";
  expiresAt: string;
  acceptedAt: string | null;
  invitedBy: { name: string | null; email: string } | null;
  createdAt: string;
}

interface ActivityEntry {
  id: string;
  action: string;
  actor: string | null;
  metadata: unknown;
  createdAt: string;
}

const ROLES = ["OWNER", "ADMIN", "MEMBER", "VIEWER"];

/**
 * Team management: members with roles, email invites with shareable
 * accept links, and the workspace activity feed from the audit log.
 * Invite creation returns the accept link; when a connected SMTP
 * account exists the API also emails it, and reports which happened.
 */
export function TeamPanel() {
  const [tab, setTab] = useState<"members" | "activity">("members");
  const [members, setMembers] = useState<Member[]>([]);
  const [yourRole, setYourRole] = useState("VIEWER");
  const [invites, setInvites] = useState<Invite[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("MEMBER");
  const [busy, setBusy] = useState(false);
  const [lastLink, setLastLink] = useState<string | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [activityTotal, setActivityTotal] = useState(0);
  const [activityPage, setActivityPage] = useState(1);

  const canManage = yourRole === "OWNER" || yourRole === "ADMIN";

  const loadTeam = useCallback(async () => {
    try {
      const membersResponse = await fetch("/api/team/members");
      if (!membersResponse.ok) throw new Error("Could not load members");
      const membersPayload = (await membersResponse.json()) as {
        members: Member[];
        yourRole: string;
      };
      setMembers(membersPayload.members);
      setYourRole(membersPayload.yourRole);
      if (membersPayload.yourRole === "OWNER" || membersPayload.yourRole === "ADMIN") {
        const invitesResponse = await fetch("/api/team/invites");
        if (invitesResponse.ok) {
          const invitesPayload = (await invitesResponse.json()) as { invites: Invite[] };
          setInvites(invitesPayload.invites);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the team");
    }
  }, []);

  const loadActivity = useCallback(async () => {
    try {
      const response = await fetch(`/api/team/activity?page=${activityPage}&pageSize=25`);
      if (!response.ok) throw new Error("Could not load activity");
      const payload = (await response.json()) as { entries: ActivityEntry[]; total: number };
      setActivity(payload.entries);
      setActivityTotal(payload.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load activity");
    }
  }, [activityPage]);

  useEffect(() => {
    void loadTeam();
  }, [loadTeam]);

  useEffect(() => {
    if (tab === "activity") {
      void loadActivity();
    }
  }, [tab, loadActivity]);

  async function createInvite(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/team/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        acceptUrl?: string;
        emailed?: boolean;
        error?: string;
      };
      if (!response.ok || !payload.acceptUrl) {
        throw new Error(payload.error ?? "Invite failed");
      }
      setLastLink(payload.acceptUrl);
      setNotice(
        payload.emailed
          ? "Invitation emailed through the workspace SMTP account. The link is also below if you want to share it directly."
          : "Invitation created. No connected SMTP account, so share the accept link below with the invitee.",
      );
      setEmail("");
      await loadTeam();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invite failed");
    } finally {
      setBusy(false);
    }
  }

  async function inviteAction(id: string, action: "resend" | "revoke") {
    setError(null);
    setNotice(null);
    try {
      const response =
        action === "resend"
          ? await fetch(`/api/team/invites/${id}/resend`, { method: "POST" })
          : await fetch(`/api/team/invites/${id}`, { method: "DELETE" });
      const payload = (await response.json().catch(() => ({}))) as {
        acceptUrl?: string;
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error ?? "Action failed");
      if (action === "resend" && payload.acceptUrl) {
        setLastLink(payload.acceptUrl);
        setNotice("Fresh accept link issued. The previous link no longer works.");
      } else {
        setNotice("Invite revoked.");
      }
      await loadTeam();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    }
  }

  async function memberAction(userId: string, action: "role" | "remove", nextRole?: string) {
    setError(null);
    setNotice(null);
    try {
      const response =
        action === "role"
          ? await fetch(`/api/team/members/${userId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ role: nextRole }),
            })
          : await fetch(`/api/team/members/${userId}`, { method: "DELETE" });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Action failed");
      setNotice(action === "role" ? "Role updated." : "Member removed.");
      await loadTeam();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    }
  }

  return (
    <div>
      <div className="flex gap-2">
        <button
          type="button"
          className={tab === "members" ? "btn-primary" : "btn-secondary"}
          onClick={() => setTab("members")}
        >
          Members
        </button>
        <button
          type="button"
          className={tab === "activity" ? "btn-primary" : "btn-secondary"}
          onClick={() => setTab("activity")}
        >
          Activity
        </button>
      </div>
      {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
      {notice ? <p className="mt-3 text-sm text-muted">{notice}</p> : null}
      {lastLink ? (
        <p className="mt-2 break-all rounded-lg bg-elevated px-3 py-2 text-sm">
          Accept link: <span className="font-medium">{lastLink}</span>
        </p>
      ) : null}

      {tab === "members" ? (
        <>
          <div className="card mt-4 overflow-hidden">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-elevated text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-3 font-medium">Member</th>
                  <th className="px-4 py-3 font-medium">Role</th>
                  <th className="px-4 py-3 font-medium">Joined</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {members.map((member) => (
                  <tr key={member.userId} className="border-b border-line last:border-0">
                    <td className="px-4 py-3">
                      <span className="font-medium">{member.name ?? member.email}</span>
                      <span className="block text-xs text-muted">
                        {member.email}
                        {member.isYou ? " (you)" : ""}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {canManage && !member.isYou ? (
                        <select
                          className="input !w-auto"
                          value={member.role}
                          onChange={(event) => memberAction(member.userId, "role", event.target.value)}
                          aria-label={`Role for ${member.email}`}
                        >
                          {ROLES.map((value) => (
                            <option key={value} value={value}>{value}</option>
                          ))}
                        </select>
                      ) : (
                        member.role
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {new Date(member.joinedAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {canManage && !member.isYou ? (
                        <button
                          type="button"
                          className="btn-ghost !px-2 !py-1 text-xs"
                          onClick={() => {
                            if (window.confirm(`Remove ${member.email} from this workspace?`)) {
                              void memberAction(member.userId, "remove");
                            }
                          }}
                        >
                          Remove
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-muted">
            The workspace always keeps at least one OWNER: the last owner cannot be demoted or
            removed. Promote another member first.
          </p>

          {canManage ? (
            <>
              <form onSubmit={createInvite} className="card mt-6 p-5">
                <h2 className="font-display text-base font-semibold">Invite a member</h2>
                <div className="mt-3 flex flex-wrap items-end gap-3">
                  <label className="flex flex-col gap-1 text-xs text-muted">
                    Email
                    <input
                      className="input w-64"
                      type="email"
                      required
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="teammate@company.com"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-muted">
                    Role
                    <select className="input" value={role} onChange={(event) => setRole(event.target.value)}>
                      {ROLES.map((value) => (
                        <option key={value} value={value}>{value}</option>
                      ))}
                    </select>
                  </label>
                  <button type="submit" className="btn-primary" disabled={busy}>
                    {busy ? "Creating..." : "Create invite"}
                  </button>
                </div>
                <p className="mt-3 text-xs text-muted">
                  The invitee signs up or signs in with this exact email, then opens the accept
                  link. Invites expire after 7 days.
                </p>
              </form>

              <div className="card mt-6 overflow-hidden">
                <h2 className="px-4 pt-4 font-display text-base font-semibold">Invitations</h2>
                {invites.length === 0 ? (
                  <p className="p-4 text-sm text-muted">No invitations yet.</p>
                ) : (
                  <table className="mt-2 w-full text-left text-sm">
                    <thead className="border-b border-line bg-elevated text-xs uppercase tracking-wide text-muted">
                      <tr>
                        <th className="px-4 py-3 font-medium">Email</th>
                        <th className="px-4 py-3 font-medium">Role</th>
                        <th className="px-4 py-3 font-medium">State</th>
                        <th className="px-4 py-3 font-medium">Expires</th>
                        <th className="px-4 py-3" />
                      </tr>
                    </thead>
                    <tbody>
                      {invites.map((invite) => (
                        <tr key={invite.id} className="border-b border-line last:border-0">
                          <td className="px-4 py-3">{invite.email}</td>
                          <td className="px-4 py-3">{invite.role}</td>
                          <td className="px-4 py-3">{invite.state}</td>
                          <td className="px-4 py-3 text-muted">
                            {new Date(invite.expiresAt).toLocaleDateString()}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {invite.state !== "ACCEPTED" ? (
                              <span className="flex justify-end gap-2">
                                <button
                                  type="button"
                                  className="btn-ghost !px-2 !py-1 text-xs"
                                  onClick={() => inviteAction(invite.id, "resend")}
                                >
                                  Resend
                                </button>
                                <button
                                  type="button"
                                  className="btn-ghost !px-2 !py-1 text-xs"
                                  onClick={() => inviteAction(invite.id, "revoke")}
                                >
                                  Revoke
                                </button>
                              </span>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          ) : (
            <p className="mt-6 text-sm text-muted">
              Inviting and managing members needs the OWNER or ADMIN role. Your role is {yourRole}.
            </p>
          )}
        </>
      ) : (
        <div className="card mt-4 overflow-hidden">
          {activity.length === 0 ? (
            <p className="p-5 text-sm text-muted">No activity recorded for this workspace yet.</p>
          ) : (
            <ul>
              {activity.map((entry) => (
                <li key={entry.id} className="border-b border-line px-4 py-3 text-sm last:border-0">
                  <span className="font-medium">{entry.action}</span>{" "}
                  <span className="text-muted">
                    by {entry.actor ?? "system"} · {new Date(entry.createdAt).toLocaleString()}
                  </span>
                  {entry.metadata ? (
                    <span className="block truncate text-xs text-muted">
                      {JSON.stringify(entry.metadata)}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center gap-3 px-4 py-3">
            <button
              type="button"
              className="btn-secondary"
              disabled={activityPage <= 1}
              onClick={() => setActivityPage((value) => Math.max(1, value - 1))}
            >
              Previous
            </button>
            <span className="text-sm text-muted">
              Page {activityPage} of {Math.max(1, Math.ceil(activityTotal / 25))}
            </span>
            <button
              type="button"
              className="btn-secondary"
              disabled={activityPage * 25 >= activityTotal}
              onClick={() => setActivityPage((value) => value + 1)}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
