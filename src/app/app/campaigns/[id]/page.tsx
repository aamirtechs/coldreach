import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionWorkspace } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { computeCampaignMetrics, type MetricEvent } from "@/lib/domain/metrics";
import { listTokens } from "@/lib/domain/personalize";
import { CampaignActions } from "@/components/campaigns/CampaignActions";
import { CampaignSettingsForm } from "@/components/campaigns/CampaignSettingsForm";
import { SequenceBuilder, type StepDraft } from "@/components/campaigns/SequenceBuilder";
import { StatusBadge, formatPercent } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionWorkspace();
  if (!session) {
    redirect("/login");
  }
  const { id } = await params;
  const workspaceId = session.workspace.id;

  const campaign = await prisma.campaign.findFirst({
    where: { id, workspaceId },
    include: {
      steps: { orderBy: { order: "asc" } },
      accounts: { include: { sendingAccount: true } },
    },
  });
  if (!campaign) {
    notFound();
  }

  const [lists, allAccounts, events, enrollmentGroups, sampleLead, totalLeadsInList] = await Promise.all([
    prisma.leadList.findMany({ where: { workspaceId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.sendingAccount.findMany({ where: { workspaceId }, orderBy: { createdAt: "asc" } }),
    prisma.emailEvent.findMany({
      where: { workspaceId, campaignId: campaign.id },
      select: { type: true, classification: true },
    }),
    prisma.enrollment.groupBy({
      by: ["status"],
      where: { campaignId: campaign.id },
      _count: true,
    }),
    campaign.leadListId
      ? prisma.lead.findFirst({
          where: { workspaceId, listId: campaign.leadListId },
          orderBy: { createdAt: "asc" },
        })
      : Promise.resolve(null),
    campaign.leadListId
      ? prisma.lead.count({ where: { workspaceId, listId: campaign.leadListId } })
      : Promise.resolve(0),
  ]);

  const metrics = computeCampaignMetrics(events as MetricEvent[]);
  const hasSimulatedSends = await prisma.emailEvent.findFirst({
    where: {
      workspaceId,
      campaignId: campaign.id,
      type: "SENT",
      sendingAccount: { provider: "SIMULATION" },
    },
    select: { id: true },
  });

  const stepDrafts: StepDraft[] = campaign.steps.map((step) => ({
    subject: step.subject,
    body: step.body,
    delayDays: step.delayDays,
    delayHours: step.delayHours,
  }));

  const availableTokens = [
    ...new Set(campaign.steps.flatMap((step) => [...listTokens(step.subject), ...listTokens(step.body)])),
  ];

  const sampleFields: Record<string, string> = {};
  if (sampleLead && sampleLead.fields && typeof sampleLead.fields === "object" && !Array.isArray(sampleLead.fields)) {
    for (const [key, value] of Object.entries(sampleLead.fields)) {
      sampleFields[key] = String(value);
    }
  }

  const editable = campaign.status !== "RUNNING" && campaign.status !== "ARCHIVED";
  const metricCards: { label: string; value: string; note: string }[] = [
    { label: "Sent", value: String(metrics.sent), note: "Recorded send events" },
    { label: "Delivered", value: String(metrics.delivered), note: `Delivery rate ${formatPercent(metrics.rates.deliveryRate)}` },
    { label: "Bounce rate", value: formatPercent(metrics.rates.bounceRate), note: `${metrics.bounced} bounced` },
    { label: "Reply rate", value: formatPercent(metrics.rates.replyRate), note: `${metrics.replies} replies` },
    { label: "Positive replies", value: String(metrics.positiveReplies), note: "Classified POSITIVE" },
    { label: "Unsubscribe rate", value: formatPercent(metrics.rates.unsubscribeRate), note: `${metrics.unsubscribes} unsubscribes` },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <Link href="/app/campaigns" className="text-sm text-accent hover:underline">
        Back to campaigns
      </Link>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <h1 className="font-display text-2xl font-semibold tracking-tight">{campaign.name}</h1>
        <StatusBadge status={campaign.status} />
        {hasSimulatedSends ? (
          <span className="text-xs text-muted">Includes DEMO sends from simulation accounts.</span>
        ) : null}
      </div>
      <p className="mt-1 text-sm text-muted">
        {campaign.timezone} · window {campaign.windowStart} to {campaign.windowEnd}
        {campaign.businessDaysOnly ? " · business days only" : ""} · {totalLeadsInList} leads in the
        attached list
      </p>

      <div className="mt-4 flex flex-wrap gap-2 text-xs text-muted">
        {enrollmentGroups.map((group) => (
          <span key={group.status} className="rounded bg-elevated px-2 py-1">
            {group.status}: {group._count}
          </span>
        ))}
        {enrollmentGroups.length === 0 ? <span>No enrollments yet.</span> : null}
      </div>

      <CampaignActions campaignId={campaign.id} status={campaign.status} />

      <CampaignSettingsForm
        campaignId={campaign.id}
        editable={editable}
        initial={{
          name: campaign.name,
          leadListId: campaign.leadListId,
          timezone: campaign.timezone,
          windowStart: campaign.windowStart,
          windowEnd: campaign.windowEnd,
          businessDaysOnly: campaign.businessDaysOnly,
          accountIds: campaign.accounts.map((entry) => entry.sendingAccount.id),
        }}
        lists={lists}
        accounts={allAccounts.map((account) => ({
          id: account.id,
          email: account.email,
          provider: account.provider,
          status: account.status,
        }))}
      />

      <SequenceBuilder
        campaignId={campaign.id}
        initialSteps={stepDrafts}
        editable={editable}
        sampleLead={sampleLead ? { email: sampleLead.email, fields: sampleFields } : null}
        availableTokens={availableTokens}
      />

      <section className="card mt-6 p-6">
        <h2 className="font-display text-lg font-semibold">Results</h2>
        <p className="mt-1 text-xs text-muted">
          Computed live from recorded email events by the metrics engine. Rates on delivered
          volume, except delivery and bounce rates, which use sent volume.
        </p>
        {metrics.sent === 0 ? (
          <p className="mt-4 text-sm text-muted">
            No sends recorded yet. Metrics appear here as soon as the worker sends and provider
            events arrive.
          </p>
        ) : (
          <>
            <div className="mt-4 grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
              {metricCards.map((card) => (
                <div key={card.label} className="rounded-lg border border-line p-3">
                  <p className="text-xs text-muted">{card.label}</p>
                  <p className="mt-1 font-display text-xl font-semibold">{card.value}</p>
                  <p className="mt-0.5 text-xs text-muted">{card.note}</p>
                </div>
              ))}
            </div>
            <div className="mt-4 rounded-lg border border-dashed border-line p-3">
              <p className="text-xs text-muted">
                Opens: {metrics.opens.count}. Opens are an unreliable signal: mail privacy
                features both inflate them (prefetching) and erase them (blocking), so they are
                reported separately and never used as a rate denominator.
              </p>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
