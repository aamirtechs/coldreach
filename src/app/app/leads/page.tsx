import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionWorkspace } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { LocalTime } from "@/components/LocalTime";
import { CreateListForm } from "@/components/leads/CreateListForm";
import { EmptyState } from "@/components/ui";
import { leadCompanyOf, leadMatchesSearch, leadNameOf } from "@/lib/leads/search";

export const dynamic = "force-dynamic";

const SEARCH_SCAN_LIMIT = 5000;
const SEARCH_RESULT_LIMIT = 100;

export default async function LeadsPage({
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
  const [lists, unlistedCount] = await Promise.all([
    prisma.leadList.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { leads: true } } },
    }),
    prisma.lead.count({ where: { workspaceId, listId: null } }),
  ]);

  // Workspace-wide lead search (v1.27.2): the per-list search inside
  // a list existed since v1.26.0, but the Leads home had none, so a
  // lead could only be found by opening its list first. Name and
  // company live in the fields JSON, so a bounded scan is filtered
  // in memory with the shared helper, the established pattern.
  let searchResults: {
    id: string;
    email: string;
    name: string;
    company: string;
    status: string;
    listId: string | null;
    listName: string | null;
  }[] = [];
  let searchTotal = 0;
  if (query) {
    const scanned = await prisma.lead.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      take: SEARCH_SCAN_LIMIT,
      select: {
        id: true,
        email: true,
        fields: true,
        status: true,
        listId: true,
        list: { select: { name: true } },
      },
    });
    const matched = scanned.filter((lead) => leadMatchesSearch(lead, query));
    searchTotal = matched.length;
    searchResults = matched.slice(0, SEARCH_RESULT_LIMIT).map((lead) => ({
      id: lead.id,
      email: lead.email,
      name: leadNameOf(lead.fields) ?? "",
      company: leadCompanyOf(lead.fields) ?? "", 
      status: lead.status,
      listId: lead.listId,
      listName: lead.list?.name ?? null,
    }));
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-wrap items-center justify-between gap-4" data-tour="leads">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Leads</h1>
          <p className="mt-1 text-sm text-muted">
            Lists are how contacts are organised and attached to campaigns. Imports are
            deduplicated and checked against the suppression list before anything is saved.
          </p>
        </div>
        <CreateListForm />
      </div>

      <form method="GET" className="card mt-6 flex flex-wrap items-end gap-3 p-4">
        <div>
          <label className="label" htmlFor="lead-search">Search name, email or company</label>
          <input id="lead-search" name="q" className="input w-72" defaultValue={query} placeholder="Jane, jane@company.com or Company Inc" />
        </div>
        <button type="submit" className="btn-primary">Search</button>
        {query ? (
          <Link href="/app/leads" className="btn-secondary">Reset</Link>
        ) : null}
      </form>

      {query ? (
        <div className="card mt-6 overflow-x-auto">
          <p className="px-4 pt-4 text-sm text-muted">
            {searchTotal === 0
              ? `No leads match "${query}".`
              : `Showing ${searchResults.length} of ${searchTotal} leads matching "${query}" across all lists.`}
          </p>
          {searchResults.length > 0 ? (
            <table className="mt-2 w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-line bg-elevated text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Company</th>
                  <th className="px-4 py-3 font-medium">List</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {searchResults.map((lead) => (
                  <tr key={lead.id} className="border-b border-line last:border-0 hover:bg-elevated/60">
                    <td className="px-4 py-3">{lead.email}</td>
                    <td className="px-4 py-3">{lead.name || "-"}</td>
                    <td className="px-4 py-3">{lead.company || "-"}</td>
                    <td className="px-4 py-3">
                      {lead.listId ? (
                        <Link href={`/app/leads/${lead.listId}`} className="text-accent hover:underline">
                          {lead.listName ?? "Open list"}
                        </Link>
                      ) : (
                        <span className="text-muted">No list</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted">{lead.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
      ) : null}

      {lists.length === 0 ? (
        <EmptyState
          title="No lead lists yet"
          body="Create a list, then import a CSV or add leads by hand. Every import reports exactly what was kept, what was a duplicate, what was invalid, and what was suppressed."
        />
      ) : (
        <div className="card mt-6 overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
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
                  <td className="px-4 py-3 text-muted">
                    <LocalTime
                      iso={list.createdAt.toISOString()}
                      fallback={list.createdAt.toLocaleDateString("en-GB", { timeZone: "UTC" })}
                      format="date"
                    />
                  </td>
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
