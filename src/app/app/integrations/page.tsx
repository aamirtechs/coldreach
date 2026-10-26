import { PhasePlaceholder } from "@/components/PhasePlaceholder";

export default function IntegrationsPage() {
  return (
    <PhasePlaceholder
      title="Integrations"
      phase="Phase 4"
      description="Integrations arrive in Phase 4. Nothing on this page will pretend to be connected: an integration appears as available only when real credentials and provider access are configured."
      bullets={[
        "CRM synchronisation through supported provider APIs.",
        "Outbound webhooks for campaign and reply events, plus a documented public API.",
        "API key management with hashed key storage, backed by the ApiKey model in the Phase 1 schema.",
        "Calendar and meeting tracking so booked meetings can be attributed to campaigns.",
        "A connection status view with actionable error messages when a provider fails.",
      ]}
    />
  );
}
