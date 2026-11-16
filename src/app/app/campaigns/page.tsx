import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionWorkspace } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { CreateCampaignForm } from "@/components/campaigns/CreateCampaignForm";
import { PauseAllCampaignsButton } from "@/components/campaigns/PauseAllCampaignsButton";
import { CampaignsTable } from "@/components/campaigns/CampaignsTable";
import { EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const session = await getSessionWorkspace();
  if (!session) {
    redirect("/login");
  }
  const workspaceId = session.workspace.id;
  const query = ((await searchParams).q ?? "").trim();
  const [campaigns, lists] = await Promise.all([
    prisma.campaign.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { steps: true, enrollments: true } },
        leadList: { select: { name: true } },
      },
    }),
    prisma.leadList.findMany({
      where: { workspaceId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);
  // Progress aggregates, batched with groupBy (no per-campaign queries):
  // an enrollment counts as contacted once its first step has sent
  // (currentStep >= 1), and sentCount is the campaign's SENT events.
  const campaignIds = (query ? campaigns.filter((campaign) => campaign.name.toLowerCase().includes(query.toLowerCase())) : campaigns).map((campaign) => campaign.id);
  const [contactedRows, sentRows, clickedRows] = await Promise.all([
    prisma.enrollment.groupBy({
      by: ["campaignId"],
      // Enrollment has no workspaceId column; the campaign id list is
      // already scoped to this workspace and is the tenant boundary.
      where: { campaignId: { in: campaignIds }, currentStep: { gte: 1 } },
      _count: { _all: true },
    }),
    prisma.emailEvent.groupBy({
      by: ["campaignId"],
      where: { workspaceId, campaignId: { in: campaignIds }, type: "SENT" },
      _count: { _all: true },
    }),
    prisma.emailEvent.groupBy({
      by: ["campaignId"],
      where: { workspaceId, campaignId: { in: campaignIds }, type: "CLICKED" },
      _count: { _all: true },
    }),
  ]);
  // Name search (v1.27.2): filter the already loaded campaigns in
  // memory; a workspace holds dozens of campaigns, not thousands.
  const visibleCampaigns = query
    ? campaigns.filter((campaign) => campaign.name.toLowerCase().includes(query.toLowerCase()))
    : campaigns;
  const pausableCount = campaigns.filter(
    (campaign) => campaign.status === "RUNNING" || campaign.status === "SCHEDULED",
  ).length;
  const contactedByCampaign = new Map(contactedRows.map((row) => [row.campaignId, row._count._all]));
  const sentByCampaign = new Map(sentRows.map((row) => [row.campaignId, row._count._all]));
  const clickedByCampaign = new Map(clickedRows.map((row) => [row.campaignId, row._count._all]));

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-wrap items-center justify-between gap-4" data-tour="campaigns">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Campaigns</h1>
          <p className="mt-1 text-sm text-muted">
            Multi-step sequences with scheduling windows, preflight launch checks, and
            suppression enforced before every send.
          </p>
        </div>
        <div className="flex items-start gap-3">
          <PauseAllCampaignsButton activeCount={pausableCount} />
          <CreateCampaignForm lists={lists} />
        </div>
      </div>

      {campaigns.length > 0 ? (
        <form method="GET" className="card mt-6 flex flex-wrap items-end gap-3 p-4">
          <div>
            <label className="label" htmlFor="camp-search">Search campaigns by name</label>
            <input id="camp-search" name="q" className="input w-72" defaultValue={query} placeholder="e.g. WordPress, Dispatch, VA" />
          </div>
          <button type="submit" className="btn-primary">Search</button>
          {query ? (
            <Link href="/app/campaigns" className="btn-secondary">Reset</Link>
          ) : null}
          {query ? (
            <p className="w-full text-sm text-muted">
              Showing {visibleCampaigns.length} of {campaigns.length} campaigns matching "{query}".
            </p>
          ) : null}
        </form>
      ) : null}

      {campaigns.length === 0 ? (
        <EmptyState
          title="No campaigns yet"
          body="Create a campaign, attach a lead list, write the sequence, and run preflight. Launch is blocked until every safety check passes."
        />
      ) : visibleCampaigns.length === 0 ? (
        <EmptyState
          title="No campaigns match that search"
          body="Try a shorter part of the campaign name, or reset the search to see every campaign."
        />
      ) : (
        <CampaignsTable
          campaigns={visibleCampaigns.map((campaign) => ({
            id: campaign.id,
            name: campaign.name,
            status: campaign.status,
            timezone: campaign.timezone,
            listName: campaign.leadList?.name ?? null,
            steps: campaign._count.steps,
            enrolled: campaign._count.enrollments,
            contacted: contactedByCampaign.get(campaign.id) ?? 0,
            sent: sentByCampaign.get(campaign.id) ?? 0,
            clicked: clickedByCampaign.get(campaign.id) ?? 0,
          }))}
        />
      )}
    </div>
  );
}
