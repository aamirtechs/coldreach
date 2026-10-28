import { redirect } from "next/navigation";
import { getSessionWorkspace } from "@/lib/auth/session";
import { AiProviderPanel } from "@/components/integrations/AiProviderPanel";
import { ApiKeysPanel } from "@/components/integrations/ApiKeysPanel";
import { WebhooksPanel } from "@/components/integrations/WebhooksPanel";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  const session = await getSessionWorkspace();
  if (!session) {
    redirect("/login");
  }
  const canManage = session.role === "ADMIN" || session.role === "OWNER";

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="font-display text-2xl font-semibold tracking-tight">Integrations</h1>
      <p className="mt-1 text-sm text-muted">
        Connect ColdReach to the rest of your stack with the public API and outbound webhooks.
        Mailbox connections (Gmail, Microsoft 365) live on the Sending Accounts page.
      </p>

      <AiProviderPanel canManage={canManage} />
      <ApiKeysPanel canManage={canManage} />
      <WebhooksPanel canManage={canManage} />

      <section className="card mt-6 p-6">
        <h2 className="font-display text-lg font-semibold">Zapier, Make, and CRMs</h2>
        <div className="mt-2 space-y-3 text-sm leading-relaxed text-muted">
          <p>
            There is no native HubSpot or Salesforce connector, and this page will not pretend
            otherwise. CRM synchronisation runs through Zapier or Make, or directly through the
            public API, which is also how most teams wire it:
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              New CRM contacts to ColdReach: a Zapier or Make scenario watches the CRM, then calls{" "}
              <span className="font-mono text-xs">POST /api/v1/leads</span> with a key holding the{" "}
              <span className="font-mono text-xs">leads:write</span> scope. Duplicates and suppressed
              addresses are refused with the reason in the response.
            </li>
            <li>
              Replies back to the CRM: point a webhook endpoint at your Zapier or Make webhook URL,
              subscribe it to REPLIED, and let the scenario create the CRM activity. The payload
              carries the lead email, campaign, and classification.
            </li>
            <li>
              Do-not-contact sync both ways: CRMs push unsubscribes to{" "}
              <span className="font-mono text-xs">POST /api/v1/suppressions</span>, and ColdReach
              pushes bounce, unsubscribe, and complaint events out through webhooks so the CRM can
              mark the contact.
            </li>
          </ul>
          <p>
            Step-by-step recipes, the API reference, and the webhook signature verification snippet
            live in API.md and INTEGRATIONS.md in the repository.
          </p>
        </div>
      </section>
    </div>
  );
}
