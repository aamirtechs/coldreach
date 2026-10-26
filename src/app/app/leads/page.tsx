import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionWorkspace } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { CreateListForm } from "@/components/leads/CreateListForm";
import { EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function LeadsPage() {
  const session = await getSessionWorkspace();
  if (!session) {
    redirect("/login");
  }
  const workspaceId = session.workspace.id;
  const [lists, unlistedCount] = await Promise.all([
    prisma.leadList.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { leads: true } } },
    }),
    prisma.lead.count({ where: { workspaceId, listId: null } }),
  ]);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Leads</h1>
          <p className="mt-1 text-sm text-muted">
            Lists are how contacts are organised and attached to campaigns. Imports are
            deduplicated and checked against the suppression list before anything is saved.
          </p>
        </div>
        <CreateListForm />
      </div>

      {lists.length === 0 ? (
        <EmptyState
          title="No lead lists yet"
          body="Create a list, then import a CSV or add leads by hand. Every import reports exactly what was kept, what was a duplicate, what was invalid, and what was suppressed."
        />
      ) : (
        <div className="card mt-6 overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-elevated text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">List</th>
                <th className="px-4 py-3 font-medium">Leads</th>
                <th className="px-4 py-3 font-medium">Created</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {lists.map((list) => (
                <tr key={list.id} className="border-b border-line last:border-0 hover:bg-elevated/60">
                  <td className="px-4 py-3">
                    <Link href={`/app/leads/${list.id}`} className="font-medium text-accent hover:underline">
                      {list.name}
                    </Link>
                    {list.description ? (
                      <p className="mt-0.5 text-xs text-muted">{list.description}</p>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">{list._count.leads}</td>
                  <td className="px-4 py-3 text-muted">{list.createdAt.toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/app/leads/${list.id}`} className="btn-secondary !px-3 !py-1.5 text-xs">
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {unlistedCount > 0 ? (
        <p className="mt-4 text-xs text-muted">
          {unlistedCount} lead{unlistedCount === 1 ? "" : "s"} in this workspace{" "}
          {unlistedCount === 1 ? "is" : "are"} not in any list.
        </p>
      ) : null}
    </div>
  );
}
