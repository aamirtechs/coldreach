"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PLAN_FEATURES, PLAN_FEATURE_LABELS, type PlanFeature } from "@/lib/domain/plans";

interface PlanInfo {
  id: string;
  name: string;
  priceMonthlyPkr: number;
  seats: number | null;
  sendingAccounts: number;
  monthlySends: number;
  features: Record<PlanFeature, boolean>;
}

interface BillingData {
  subscription: {
    plan: string;
    status: string;
    stripeCustomerId: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    effectivePlan: string;
    expired: boolean;
  };
  plans: PlanInfo[];
  usage: {
    sentThisMonth: number;
    sendingAccounts: number;
    seatsUsed: number;
    members: number;
    pendingInvites: number;
  };
  stripe: { configured: boolean; missingEnv: string[]; webhookConfigured: boolean };
}

function UsageBar({ label, used, limit, note }: { label: string; used: number; limit: number | null; note?: string }) {
  const percent = limit === null ? 0 : Math.min(100, (used / Math.max(1, limit)) * 100);
  const over = limit !== null && used > limit;
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className={over ? "text-warning" : "text-muted"}>
          {used.toLocaleString()} / {limit === null ? "unlimited" : limit.toLocaleString()}
          {note ? ` · ${note}` : ""}
        </span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded bg-elevated">
        <div className={`h-full ${over ? "bg-warning" : "bg-accent"}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

export function BillingPanel({ isOwner }: { isOwner: boolean }) {
  const router = useRouter();
  const [data, setData] = useState<BillingData | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/billing");
    if (response.ok) {
      setData(await response.json());
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function checkout(plan: string) {
    setBusy(`checkout:${plan}`);
    setNotice(null);
    const response = await fetch("/api/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan }),
    });
    const result = await response.json();
    setBusy(null);
    if (!response.ok) {
      setNotice(result.error ?? "Checkout could not be started");
      return;
    }
    window.location.href = result.url;
  }

  async function portal() {
    setBusy("portal");
    const response = await fetch("/api/billing/portal");
    const result = await response.json();
    setBusy(null);
    if (!response.ok) {
      setNotice(result.error ?? "The billing portal could not be opened");
      return;
    }
    window.location.href = result.url;
  }

  const [keyCode, setKeyCode] = useState("");

  async function redeem() {
    setBusy("redeem");
    setNotice(null);
    try {
      const response = await fetch("/api/billing/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: keyCode }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setNotice(result.error ?? "That key could not be redeemed.");
        return;
      }
      setKeyCode("");
      setNotice(
        `${result.planName} is active until ${new Date(result.currentPeriodEnd).toLocaleDateString()}.`,
      );
      load();
      router.refresh();
    } catch {
      setNotice("That key could not be redeemed. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  async function override(plan: string) {
    setBusy(`override:${plan}`);
    setNotice(null);
    const response = await fetch("/api/billing/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan }),
    });
    const result = await response.json();
    setBusy(null);
    if (!response.ok) {
      setNotice(result.error ?? "The plan could not be changed");
      return;
    }
    setNotice(`Plan set to ${plan} by manual override.`);
    load();
    router.refresh();
  }

  if (!data) {
    return <p className="mt-6 text-sm text-muted">Loading billing...</p>;
  }

  const granted = data.plans.find((plan) => plan.id === data.subscription.plan) ?? data.plans[0];
  const current =
    data.plans.find((plan) => plan.id === data.subscription.effectivePlan) ?? granted;

  return (
    <div>
      {!data.stripe.configured ? (
        <div className="card mt-6 border-dashed p-6">
          <h2 className="font-display text-lg font-semibold">Pay with a subscription key</h2>
          <p className="mt-1 text-sm text-muted">
            Paid plans are activated with a subscription key from the ColdReach team. Buy a key,
            then redeem it below and the plan runs for the key's days. Card checkout (Stripe) is
            not configured on this server yet, so the manual override below remains available to
            owners.
          </p>
        </div>
      ) : !data.stripe.webhookConfigured ? (
        <p className="mt-4 text-sm text-warning">
          Stripe checkout is configured, but STRIPE_WEBHOOK_SECRET is missing, so plan changes will
          not sync back from Stripe yet.
        </p>
      ) : null}

      <section className="card mt-6 p-6">
        <h2 className="font-display text-lg font-semibold">
          Current plan: {current.name}
          <span className="ml-2 align-middle text-sm font-normal text-muted">
            status {data.subscription.status}
            {data.subscription.currentPeriodEnd && !data.subscription.expired
              ? ` · paid until ${new Date(data.subscription.currentPeriodEnd).toLocaleDateString()}`
              : ""}
            {data.subscription.cancelAtPeriodEnd ? " · cancels at period end" : ""}
          </span>
        </h2>
        {data.subscription.expired ? (
          <p className="mt-2 text-sm text-warning">
            Your {granted.name} time ended
            {data.subscription.currentPeriodEnd
              ? ` on ${new Date(data.subscription.currentPeriodEnd).toLocaleDateString()}`
              : ""}
            . This workspace is running on Free limits now. Redeem a new key below to switch
            back, your data and campaigns are untouched.
          </p>
        ) : null}
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <UsageBar label="Sends this month" used={data.usage.sentThisMonth} limit={current.monthlySends} />
          <UsageBar label="Sending accounts" used={data.usage.sendingAccounts} limit={current.sendingAccounts} />
          <UsageBar
            label="Seats"
            used={data.usage.seatsUsed}
            limit={current.seats}
            note={`${data.usage.members} members, ${data.usage.pendingInvites} pending invites`}
          />
        </div>
        {data.stripe.configured && data.subscription.stripeCustomerId && isOwner ? (
          <button type="button" className="btn-secondary mt-5" onClick={portal} disabled={busy !== null}>
            {busy === "portal" ? "Opening..." : "Manage subscription in Stripe"}
          </button>
        ) : null}
      </section>

      {isOwner ? (
        <section className="card mt-6 p-6">
          <h2 className="font-display text-lg font-semibold">Have a subscription key?</h2>
          <p className="mt-1 text-sm text-muted">
            Paste the key you received from the ColdReach team. It activates its plan for this
            workspace only, and if you still have paid time left, the new days are added on top
            so no days are lost.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <input
              className="input w-80 font-mono"
              type="text"
              placeholder="CR-XXXX-XXXX-XXXX-XXXX"
              value={keyCode}
              onChange={(event) => setKeyCode(event.target.value)}
            />
            <button
              type="button"
              className="btn-primary"
              onClick={redeem}
              disabled={busy !== null || keyCode.trim().length === 0}
            >
              {busy === "redeem" ? "Redeeming..." : "Redeem key"}
            </button>
          </div>
        </section>
      ) : null}

      <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {data.plans.map((plan) => {
          const isCurrent = plan.id === data.subscription.plan;
          const includedFeatures = PLAN_FEATURES.filter((feature) => plan.features[feature]);
          return (
            <div key={plan.id} className={`card p-5 ${isCurrent ? "border-accent" : ""}`}>
              <h3 className="font-display text-base font-semibold">{plan.name}</h3>
              <p className="mt-1 font-display text-2xl font-semibold">
                {plan.priceMonthlyPkr === 0 ? "Free" : `Rs. ${plan.priceMonthlyPkr}`}
                {plan.priceMonthlyPkr > 0 ? <span className="text-sm font-normal text-muted">/mo</span> : null}
              </p>
              <ul className="mt-3 space-y-1 text-sm text-muted">
                <li>{plan.monthlySends.toLocaleString()} sends / month</li>
                <li>{plan.sendingAccounts} sending accounts</li>
                <li>{plan.seats === null ? "Unlimited seats" : `${plan.seats} seats`}</li>
                {includedFeatures.map((feature) => (
                  <li key={feature}>{PLAN_FEATURE_LABELS[feature]}</li>
                ))}
              </ul>
              {isCurrent ? (
                <p className="mt-4 text-sm font-medium text-accent">Current plan</p>
              ) : isOwner ? (
                <div className="mt-4 flex flex-col gap-2">
                  {data.stripe.configured && plan.priceMonthlyPkr > 0 ? (
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => checkout(plan.id)}
                      disabled={busy !== null}
                    >
                      {busy === `checkout:${plan.id}` ? "Starting checkout..." : `Upgrade to ${plan.name}`}
                    </button>
                  ) : null}
                  {!data.stripe.configured ? (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => override(plan.id)}
                      disabled={busy !== null}
                    >
                      {busy === `override:${plan.id}` ? "Setting..." : `Set ${plan.name} (manual override)`}
                    </button>
                  ) : null}
                </div>
              ) : (
                <p className="mt-4 text-xs text-muted">Only the workspace owner can change the plan.</p>
              )}
            </div>
          );
        })}
      </section>

      {!data.stripe.configured ? (
        <p className="mt-4 text-xs text-muted">
          The manual override is the pre-Stripe plan switch: it changes the plan quotas immediately
          and every change is written to the activity log. It does not charge anything.
        </p>
      ) : null}
      {notice ? <p className="mt-3 text-sm text-muted">{notice}</p> : null}
    </div>
  );
}
