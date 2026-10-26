import { PhasePlaceholder } from "@/components/PhasePlaceholder";

export default function SettingsPage() {
  return (
    <PhasePlaceholder
      title="Settings"
      phase="Phase 4"
      description="Full account and workspace settings land in Phase 4, together with billing. Workspace identity and roles already exist in the data model from Phase 1."
      bullets={[
        "Workspace profile, default timezone, and default sending window.",
        "Subscription plan, usage metering, and billing history through the billing provider.",
        "Data retention controls and workspace data deletion workflows.",
        "Workspace level suppression management, including imports of do-not-contact lists.",
      ]}
    />
  );
}
