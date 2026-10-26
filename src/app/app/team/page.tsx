import { TeamPanel } from "@/components/team/TeamPanel";

export const dynamic = "force-dynamic";

export default function TeamPage() {
  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="font-display text-2xl font-semibold tracking-tight">Team</h1>
      <p className="mt-1 text-sm text-muted">
        Members, roles, and invitations for this workspace, plus the activity feed from the
        audit log. Switch between your workspaces any time from the top bar.
      </p>
      <div className="mt-6">
        <TeamPanel />
      </div>
    </div>
  );
}
