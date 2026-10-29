import { redirect } from "next/navigation";
import { getSessionWorkspace } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { LocalTime } from "@/components/LocalTime";
import { effectiveDailyLimit } from "@/lib/domain/limits";
import { warmupCapFor, warmupProgress } from "@/lib/domain/warmup";
import { AccountForm } from "@/components/accounts/AccountForm";
import { AccountActions } from "@/components/accounts/AccountActions";
import { WarmupControl } from "@/components/accounts/WarmupControl";
import { OAuthConnect } from "@/components/accounts/OAuthConnect";
import { SyncButton } from "@/components/accounts/SyncButton";
import { DeliverabilityPanel } from "@/components/accounts/DeliverabilityPanel";
import { DemoBadge, EmptyState, StatusBadge } from "@/components/ui";
import { computeAccountHealthForAccounts, type AccountHealthState } from "@/lib/accountHealth";

const HEALTH_STYLES: Record<AccountHealthState, string> = {
  healthy: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  attention: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  critical: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
};
const HEALTH_LABELS: Record<AccountHealthState, string> = {
  healthy: "Healthy",
  attention: "Needs attention",
  critical: "Critical",
};

export const dynamic = "force-dynamic";

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ oauth?: string; detail?: string }>;
}) {
  const session = await getSessionWorkspace();
  if (!session) {
    redirect("/login");
  }
  const { oauth, detail } = await searchParams;
  const workspaceId = session.workspace.id;
  const accounts = await prisma.sendingAccount.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "asc" },
  });

  const dayStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
  const sentToday = new Map<string, number>();
  if (accounts.length > 0) {
    const grouped = await prisma.emailEvent.groupBy({
      by: ["sendingAccountId"],
      where: {
        workspaceId,
        type: "SENT",
        occurredAt: { gte: dayStart },
        sendingAccountId: { in: accounts.map((a) => a.id) },
      },
      _count: true,
    });
    for (const row of grouped) {
      if (row.sendingAccountId) sentToday.set(row.sendingAccountId, row._count);
    }
  }

  const healthByAccountId = await computeAccountHealthForAccounts(prisma, accounts);

  const now = Date.now();

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-wrap items-center justify-between gap-4" data-tour="accounts">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Sending Accounts</h1>
          <p className="mt-1 text-sm text-muted">
            Mailboxes campaigns send from. Limits ramp gradually for new accounts, and the
            worker never exceeds an account's effective daily limit.
          </p>
        </div>
        <AccountForm />
      </div>

      <OAuthConnect
        oauthResult={oauth ? { outcome: oauth, detail } : undefined}
      />

      {accounts.length === 0 ? (
        <EmptyState
          title="No sending accounts yet"
          body="Add a simulation account to exercise campaigns end to end in DEMO mode, an SMTP account whose credentials live in the server environment, or connect a Gmail or Microsoft 365 mailbox above."
        />
      ) : (
        <div className="card mt-6 overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-elevated text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Account</th>
                <th className="px-4 py-3 font-medium">Provider</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Health</th>
                <th className="px-4 py-3 font-medium">Sent today / effective limit</th>
                <th className="px-4 py-3 font-medium">Hard cap</th>
                <th className="px-4 py-3 font-medium">Warm-up</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => {
                const rampLimit = effectiveDailyLimit({
                  dailyLimit: account.dailyLimit,
                  ageInDays: Math.max(0, Math.floor((now - account.createdAt.getTime()) / 86400000)),
                });
                // Same rule the worker enforces: the warm-up ceiling
                // can only lower the ramp limit, never raise it.
                const warmupCeiling = warmupCapFor(account, new Date(now));
                const effective =
                  warmupCeiling === null ? rampLimit : Math.min(rampLimit, warmupCeiling);
                return (
                  <tr key={account.id} className="border-b border-line last:border-0 hover:bg-elevated/60">
                    <td className="px-4 py-3">
                      <span className="font-medium">{account.email}</span>
                      {account.displayName ? <p className="text-xs text-muted">{account.displayName}</p> : null}
                      {account.lastError ? <p className="mt-0.5 text-xs text-warning">{account.lastError}</p> : null}
                    </td>
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-2">
                        {account.provider}
                        {account.provider === "SIMULATION" ? <DemoBadge /> : null}
                      </span>
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={account.status} /></td>
                    <td className="px-4 py-3">
                      {(() => {
                        const health = healthByAccountId.get(account.id) ?? {
                          state: "healthy" as AccountHealthState,
                          reasons: [] as string[],
                        };
                        return (
                          <div>
                            <span
                              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${HEALTH_STYLES[health.state]}`}
                            >
                              {HEALTH_LABELS[health.state]}
                            </span>
                            {health.reasons.map((reason) => (
                              <p key={reason} className="mt-0.5 text-xs text-muted">
                                {reason}
                              </p>
                            ))}
                          </div>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-3">{sentToday.get(account.id) ?? 0} / {effective}</td>
                    <td className="px-4 py-3">{account.dailyLimit}</td>
                    <td className="px-4 py-3">
                      {(() => {
                        const today = new Date(now);
                        const progress = warmupProgress(account.warmupStartedAt, today);
                        return (
                          <WarmupControl
                            accountId={account.id}
                            warmupEnabled={account.warmupEnabled}
                            warmupStartedAt={
                              account.warmupStartedAt ? account.warmupStartedAt.toISOString() : null
                            }
                            capToday={warmupCapFor(account, today)}
                            progressDay={account.warmupEnabled ? progress.day : null}
                            progressTotal={progress.totalDays}
                            progressComplete={progress.complete}
                          />
                        );
                      })()}
                    </td>
                    <td className="px-4 py-3">
                      <span className="flex items-start justify-end gap-2">
                        {((account.provider === "GMAIL" || account.provider === "MS365") &&
                          account.encryptedCredentials) ||
                        account.provider === "SMTP" ? (
                          <SyncButton accountId={account.id} />
                        ) : null}
                        <AccountActions accountId={account.id} status={account.status} />
                      </span>
                      {account.lastSyncAt ? (
                        <p className="mt-1 text-right text-[11px] text-muted">
                          Last reply sync{" "}
                          <LocalTime
                            iso={account.lastSyncAt.toISOString()}
                            fallback={`${account.lastSyncAt.toLocaleString("en-US", { timeZone: "UTC" })} UTC`}
                            format="full"
                          />
                        </p>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-4 text-xs text-muted">
        Effective limits come from the limits engine: 20 percent of the cap on day one, rising
        linearly to the full cap over 14 days. Sent today counts recorded SENT events since
        midnight UTC. Warm-up is a separate, optional ceiling on top of that: when enabled, an
        account is also capped at 20 sends a day in week 1, 50 in week 2, 100 in week 3, and 200
        in week 4, counted from the day warm-up was switched on; the worker always applies the
        lower of the two limits.
      </p>

      <DeliverabilityPanel />
    </div>
  );
}
