import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { getSessionWorkspace } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { findSuppression } from "@/lib/domain/suppression";
import { loadSuppressions } from "@/lib/suppressions";
import { AddLeadForm } from "@/components/leads/AddLeadForm";
import { ImportWizard } from "@/components/leads/ImportWizard";
import { LeadsTable, type LeadRow } from "@/components/leads/LeadsTable";
import { ListActions } from "@/components/leads/ListActions";
import { EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export default async function LeadListDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ search?: string; status?: string; tag?: string; page?: string }>;
}) {
  const session = await getSessionWorkspace();
  if (!session) {
    redirect("/login");
  }
  const { id } = await params;
  const query = await searchParams;
  const workspaceId = session.workspace.id;

  const list = await prisma.leadList.findFirst({ where: { id, workspaceId } });
  if (!list) {
    notFound();
  }

  const search = (query.search ?? "").trim();
  const status = (query.status ?? "").trim();
  const tag = (query.tag ?? "").trim();
  const page = Math.max(1, Number.parseInt(query.page ?? "1", 10) || 1);

  const where: Prisma.LeadWhereInput = { workspaceId, listId: list.id };
  if (status) where.status = status as Prisma.EnumLeadStatusFilter["equals"];
  if (search) where.email = { contains: search.toLowerCase() };

  // Pagination happens in the database. A tag filter cannot (tags
  // are a JSON array), so it scans a bounded window of the newest
  // TAG_SCAN_LIMIT leads, matching the session leads API.
  const TAG_SCAN_LIMIT = 5000;
  let total: number;
  let pageLeads: Awaited<ReturnType<typeof prisma.lead.findMany>>;
  if (tag) {
    const scanned = await prisma.lead.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: TAG_SCAN_LIMIT,
    });
    const filtered = scanned.filter(
      (lead) => Array.isArray(lead.tags) && lead.tags.map(String).includes(tag),
    );
    total = filtered.length;
    pageLeads = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  } else {
    total = await prisma.lead.count({ where });
    pageLeads = await prisma.lead.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    });
  }
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Tag discovery for the filter dropdown: bounded to the newest
  // TAG_SCAN_LIMIT leads, the same window the tag filter scans.
  const allTags = [
    ...new Set(
      (
        await prisma.lead.findMany({
          where: { workspaceId, listId: list.id },
          select: { tags: true },
          orderBy: { createdAt: "desc" },
          take: TAG_SCAN_LIMIT,
        })
      ).flatMap((lead) => (Array.isArray(lead.tags) ? lead.tags.map(String) : [])),
    ),
  ].sort();

  const suppressions = await loadSuppressions(prisma, workspaceId);
  const rows: LeadRow[] = pageLeads.map((lead) => ({
    id: lead.id,
    email: lead.email,
    status: lead.status,
    fields:
      lead.fields && typeof lead.fields === "object" && !Array.isArray(lead.fields)
        ? (lead.fields as Record<string, unknown>)
        : {},
    tags: Array.isArray(lead.tags) ? lead.tags.map(String) : [],
    suppressed: findSuppression(lead.email, suppressions) !== null,
    createdAt: lead.createdAt.toISOString(),
  }));

  return (
    <div className="mx-auto max-w-6xl">
      <Link href="/app/leads" className="text-sm text-accent hover:underline">
        Back to lists
      </Link>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">{list.name}</h1>
          {list.description ? <p className="mt-1 text-sm text-muted">{list.description}</p> : null}
          <p className="mt-1 text-sm text-muted">{total} lead{total === 1 ? "" : "s"} in this list</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex gap-3">
            <AddLeadForm listId={list.id} />
          </div>
          <ListActions listId={list.id} listName={list.name} />
        </div>
      </div>

      <ImportWizard listId={list.id} />

      {total === 0 && !search && !status && !tag ? (
        <EmptyState
          title="This list is empty"
          body="Import a CSV above or add leads by hand. Suppressed addresses are refused at import time, with the reason reported per row."
        />
      ) : (
        <LeadsTable
          listId={list.id}
          leads={rows}
          total={total}
          page={page}
          totalPages={totalPages}
          allTags={allTags}
          query={{ search, status, tag }}
        />
      )}
    </div>
  );
}
