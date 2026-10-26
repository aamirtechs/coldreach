import { PhasePlaceholder } from "@/components/PhasePlaceholder";

export default function CampaignsPage() {
  return (
    <PhasePlaceholder
      title="Campaigns"
      phase="Phase 2"
      description="Campaign creation and the sequence builder are the core of Phase 2. The data model, scheduling engine, and suppression rules they depend on are already built and tested in Phase 1."
      bullets={[
        "Campaign list with create, edit, duplicate, archive, pause, resume, and schedule actions.",
        "Visual sequence builder with per-step delays, subject and body editing, and personalisation tokens with fallbacks.",
        "Sending windows, campaign timezone, and business day rules, computed by the scheduling engine already in the codebase.",
        "Preflight validation that blocks sending on unresolved personalisation tokens, suppressed leads, or duplicate enrollments.",
        "Automatic stop of follow-ups when a lead replies, unsubscribes, bounces, or is suppressed.",
      ]}
    />
  );
}
