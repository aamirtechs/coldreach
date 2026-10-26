import { PhasePlaceholder } from "@/components/PhasePlaceholder";

export default function TeamPage() {
  return (
    <PhasePlaceholder
      title="Team"
      phase="Phase 3"
      description="Team management builds on the tenancy foundation in Phase 1: workspaces, memberships, and the OWNER, ADMIN, MEMBER, and VIEWER roles already exist and are enforced by a role helper."
      bullets={[
        "Invite members by email and assign workspace roles.",
        "Agency friendly client workspaces, each with its own accounts, campaigns, leads, and reporting.",
        "Thread assignment and activity history per member.",
        "Audit log viewer for sensitive operations, backed by the audit records written since Phase 1.",
      ]}
    />
  );
}
