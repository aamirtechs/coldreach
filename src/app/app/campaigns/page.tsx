import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionWorkspace } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { CreateCampaignForm } from "@/components/campaigns/CreateCampaignForm";
import { EmptyState, StatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  const session = await getSessionWorkspace();
  if (!session) {
    redirect("/login");
  }
  const workspaceId = session.workspace.id;
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

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Campaigns</h1>
          <p className="mt-1 text-sm text-muted">
            Multi-step sequences with scheduling windows, preflight launch checks, and
            suppression enforced before every send.
          </p>
        </div>
        <CreateCampaignForm lists={lists} />
      </div>

      {campaigns.length === 0 ? (
        <EmptyState
          title="No campaigns yet"
          body="Create a campaign, attach a lead list, write the sequence, and run preflight. Launch is blocked until every safety check passes."
        />
      ) : (
        <div className="card mt-6 overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-elevated text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Campaign</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">List</th>
                <th className="px-4 py-3 font-medium">Steps</th>
                <th className="px-4 py-3 font-medium">Enrolled</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {campaigns.map((campaign) => (
                <tr key={campaign.id} className="border-b border-line last:border-0 hover:bg-elevated/60">
                  <td className="px-4 py-3">
                    <Link href={`/app/campaigns/${campaign.id}`} className="font-medium text-accent hover:underline">
                      {campaign.name}
                    </Link>
                    <p className="mt-0.5 text-xs text-muted">{campaign.timezone}</p>
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={campaign.status} /></td>
                  <td className="px-4 py-3 text-muted">{campaign.leadList?.name ?? "Not attached"}</td>
                  <td className="px-4 py-3">{campaign._count.steps}</td>
                  <td className="px-4 py-3">{campaign._count.enrollments}</td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/app/campaigns/${campaign.id}`} className="btn-secondary !px-3 !py-1.5 text-xs">
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
