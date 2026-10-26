import { PhasePlaceholder } from "@/components/PhasePlaceholder";

export default function AccountsPage() {
  return (
    <PhasePlaceholder
      title="Sending Accounts"
      phase="Phase 2"
      description="Connecting mailboxes lands in Phase 2 with OAuth for Gmail and Microsoft 365 and credential based SMTP. The account model, daily limits, and ramp rules are already defined and tested."
      bullets={[
        "Connect Gmail, Microsoft 365, or SMTP accounts, scoped per workspace.",
        "Per-account daily limits with a gradual ramp for new accounts, computed by the limits engine already in the codebase.",
        "Connection health, last error reporting, and inbox rotation across accounts in a campaign.",
        "SPF, DKIM, and DMARC guidance with DNS record verification for sending domains.",
        "Warm-up only through a legitimate external provider integration, or clearly labelled simulation in demo contexts. No deliverability guarantees, ever.",
      ]}
    />
  );
}
