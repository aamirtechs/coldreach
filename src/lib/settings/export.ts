import type { PrismaClient } from "@prisma/client";

/**
 * Workspace data export (Settings, OWNER only).
 *
 * Produces a single JSON document with everything a tenant owns,
 * shaped for recovery (scripts/restore-workspace.ts reads it) and
 * for plain record keeping. Redaction is structural, not a filter
 * applied afterwards: credential-bearing fields are never selected
 * in the first place. Sending accounts export provider, email, and
 * status only (no credentialRef, no encrypted OAuth tokens, no
 * provider account ids); API keys export their display prefix only
 * (never the hash); webhook endpoints export no secret; members
 * export email and role (never password hashes); invites export no
 * token hash. Audit metadata is the one free-form JSON in the
 * payload, so it passes through stripForbiddenKeys below.
 *
 * The audit log section is capped at AUDIT_EXPORT_LIMIT newest rows
 * with an explicit truncated flag, so the export stays one file.
 */

export const EXPORT_FORMAT = "coldreach-workspace-export";
export const EXPORT_VERSION = 1;
export const AUDIT_EXPORT_LIMIT = 10_000;

const FORBIDDEN_KEY_PATTERN =
  /password|hash|secret|credential|token|apikey|api_key|privatekey|private_key/i;

/** Recursively drops object keys that look credential-bearing. */
export function stripForbiddenKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripForbiddenKeys);
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_KEY_PATTERN.test(key)) {
        continue;
      }
      out[key] = stripForbiddenKeys(entry);
    }
    return out;
  }
  return value;
}

const iso = (date: Date | null | undefined): string | null =>
  date ? date.toISOString() : null;

export async function buildWorkspaceExport(db: PrismaClient, workspaceId: string) {
  const workspace = await db.workspace.findUnique({ where: { id: workspaceId } });
  if (!workspace) {
    return null;
  }

  const [
    memberships,
    leadLists,
    leads,
    campaigns,
    steps,
    variants,
    campaignAccounts,
    enrollmentGroups,
    suppressions,
    sendingAccounts,
    threads,
    subscription,
    apiKeys,
    webhookEndpoints,
    invites,
    auditTotal,
    auditRows,
  ] = await Promise.all([
    db.membership.findMany({
      where: { workspaceId },
      include: { user: { select: { name: true, email: true } } },
      orderBy: { createdAt: "asc" },
    }),
    db.leadList.findMany({ where: { workspaceId }, orderBy: { createdAt: "asc" } }),
    db.lead.findMany({ where: { workspaceId }, orderBy: { createdAt: "asc" } }),
    db.campaign.findMany({ where: { workspaceId }, orderBy: { createdAt: "asc" } }),
    db.sequenceStep.findMany({
      where: { campaign: { workspaceId } },
      orderBy: [{ campaignId: "asc" }, { order: "asc" }],
    }),
    db.stepVariant.findMany({ where: { step: { campaign: { workspaceId } } } }),
    db.campaignAccount.findMany({ where: { campaign: { workspaceId } } }),
    db.enrollment.groupBy({
      by: ["campaignId", "status"],
      where: { campaign: { workspaceId } },
      _count: { _all: true },
    }),
    db.suppression.findMany({
      where: { workspaceId, scope: "WORKSPACE" },
      orderBy: { createdAt: "asc" },
    }),
    db.sendingAccount.findMany({ where: { workspaceId }, orderBy: { createdAt: "asc" } }),
    db.thread.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "asc" },
      include: {
        messages: { orderBy: { occurredAt: "asc" } },
        notes: {
          orderBy: { createdAt: "asc" },
          include: { author: { select: { email: true } } },
        },
      },
    }),
    db.subscription.findUnique({ where: { workspaceId } }),
    db.apiKey.findMany({ where: { workspaceId }, orderBy: { createdAt: "asc" } }),
    db.webhookEndpoint.findMany({ where: { workspaceId }, orderBy: { createdAt: "asc" } }),
    db.invite.findMany({ where: { workspaceId }, orderBy: { createdAt: "asc" } }),
    db.auditLog.count({ where: { workspaceId } }),
    db.auditLog.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      take: AUDIT_EXPORT_LIMIT,
      include: { user: { select: { email: true } } },
    }),
  ]);

  const leadsByList = new Map<string | null, number>();
  for (const lead of leads) {
    leadsByList.set(lead.listId, (leadsByList.get(lead.listId) ?? 0) + 1);
  }

  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    workspace: {
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      senderName: workspace.senderName,
      senderAddress: workspace.senderAddress,
      createdAt: iso(workspace.createdAt),
    },
    members: memberships.map((membership) => ({
      email: membership.user.email,
      name: membership.user.name,
      role: membership.role,
      joinedAt: iso(membership.createdAt),
    })),
    leadLists: leadLists.map((list) => ({
      id: list.id,
      name: list.name,
      description: list.description,
      leadCount: leadsByList.get(list.id) ?? 0,
      createdAt: iso(list.createdAt),
    })),
    leads: leads.map((lead) => ({
      id: lead.id,
      listId: lead.listId,
      email: lead.email,
      fields: lead.fields,
      tags: lead.tags,
      status: lead.status,
      createdAt: iso(lead.createdAt),
    })),
    campaigns: campaigns.map((campaign) => ({
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      leadListId: campaign.leadListId,
      timezone: campaign.timezone,
      windowStart: campaign.windowStart,
      windowEnd: campaign.windowEnd,
      businessDaysOnly: campaign.businessDaysOnly,
      sendingAccountIds: campaignAccounts
        .filter((link) => link.campaignId === campaign.id)
        .map((link) => link.sendingAccountId),
      createdAt: iso(campaign.createdAt),
    })),
    steps: steps.map((step) => ({
      id: step.id,
      campaignId: step.campaignId,
      order: step.order,
      delayDays: step.delayDays,
      delayHours: step.delayHours,
      subject: step.subject,
      body: step.body,
    })),
    variants: variants.map((variant) => ({
      id: variant.id,
      stepId: variant.stepId,
      label: variant.label,
      subject: variant.subject,
      bodyText: variant.bodyText,
      bodyHtml: variant.bodyHtml,
      weight: variant.weight,
    })),
    // Enrollments are operational state, exported as counts only:
    // enough to reconcile a restore, without a second copy of the
    // sending queue.
    enrollmentCounts: enrollmentGroups.map((group) => ({
      campaignId: group.campaignId,
      status: group.status,
      count: group._count._all,
    })),
    suppressions: suppressions.map((suppression) => ({
      email: suppression.email,
      domain: suppression.domain,
      reason: suppression.reason,
      createdAt: iso(suppression.createdAt),
    })),
    sendingAccounts: sendingAccounts.map((account) => ({
      id: account.id,
      provider: account.provider,
      email: account.email,
      displayName: account.displayName,
      status: account.status,
      dailyLimit: account.dailyLimit,
      warmupStatus: account.warmupStatus,
      lastSyncAt: iso(account.lastSyncAt),
      createdAt: iso(account.createdAt),
    })),
    threads: threads.map((thread) => ({
      id: thread.id,
      campaignId: thread.campaignId,
      leadId: thread.leadId,
      sendingAccountId: thread.sendingAccountId,
      subject: thread.subject,
      status: thread.status,
      classification: thread.classification,
      unread: thread.unread,
      lastMessageAt: iso(thread.lastMessageAt),
      createdAt: iso(thread.createdAt),
      messages: thread.messages.map((message) => ({
        direction: message.direction,
        fromEmail: message.fromEmail,
        toEmail: message.toEmail,
        subject: message.subject,
        body: message.body,
        occurredAt: iso(message.occurredAt),
      })),
      notes: thread.notes.map((note) => ({
        authorEmail: note.author.email,
        body: note.body,
        createdAt: iso(note.createdAt),
      })),
    })),
    subscription: subscription
      ? {
          plan: subscription.plan,
          status: subscription.status,
          currentPeriodEnd: iso(subscription.currentPeriodEnd),
          cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
        }
      : null,
    apiKeys: apiKeys.map((key) => ({
      name: key.name,
      prefix: key.prefix,
      scopes: key.scopes,
      lastUsedAt: iso(key.lastUsedAt),
      revokedAt: iso(key.revokedAt),
      createdAt: iso(key.createdAt),
    })),
    webhookEndpoints: webhookEndpoints.map((endpoint) => ({
      url: endpoint.url,
      eventTypes: endpoint.eventTypes,
      active: endpoint.active,
      createdAt: iso(endpoint.createdAt),
    })),
    invites: invites.map((invite) => ({
      email: invite.email,
      role: invite.role,
      expiresAt: iso(invite.expiresAt),
      acceptedAt: iso(invite.acceptedAt),
      createdAt: iso(invite.createdAt),
    })),
    auditLog: {
      total: auditTotal,
      exported: auditRows.length,
      truncated: auditTotal > auditRows.length,
      entries: auditRows.map((row) => ({
        action: row.action,
        actorEmail: row.user?.email ?? null,
        metadata: stripForbiddenKeys(row.metadata ?? null),
        createdAt: iso(row.createdAt),
      })),
    },
  };
}

export type WorkspaceExport = NonNullable<Awaited<ReturnType<typeof buildWorkspaceExport>>>;
