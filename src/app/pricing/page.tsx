import Link from "next/link";
import { getSessionWorkspace } from "@/lib/auth/session";
import { PLACEHOLDER_PRICING_NOTE, formatNumber, pricingRows } from "@/lib/marketing/pricing";

/**
 * Public pricing page (Phase 6, Stage B).
 *
 * Rendered entirely from the plan catalog via
 * src/lib/marketing/pricing.ts, which formats
 * src/lib/domain/plans.ts without adding values of its own, so this
 * page, the billing page, and the quota engine always agree. Prices
 * are placeholder pricing and are labelled as such, exactly as on
 * the billing page.
 */
export const dynamic = "force-dynamic";

export default async function PricingPage() {
  const rows = pricingRows();
  const session = await getSessionWorkspace().catch(() => null);
  const ctaHref = session ? "/app/billing" : "/signup";
  const ctaLabel = session ? "Manage billing" : "Start free";

  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/" className="font-display text-lg font-semibold tracking-tight">
            ColdReach
          </Link>
          <nav className="flex items-center gap-5 text-sm">
            <Link href="/pricing" className="font-medium">
              Pricing
            </Link>
            {session ? (
              <Link href="/app" className="btn-primary">
                Open the app
              </Link>
            ) : (
              <>
                <Link href="/login" className="text-muted hover:text-primary">
                  Sign in
                </Link>
                <Link href="/signup" className="btn-primary">
                  Get started
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-16">
        <div className="mx-auto max-w-2xl text-center">
          <h1 className="font-display text-4xl font-semibold tracking-tight sm:text-5xl">Pricing</h1>
          <p className="mt-4 text-lg text-muted">
            Every plan includes the full product: campaigns and sequences, preflight checks,
            suppression handling, the unified inbox, deliverability diagnostics, the public API,
            and outbound webhooks. Plans differ only in seats, sending accounts, and monthly send
            volume.
          </p>
          <p className="mt-3 text-sm text-warning">{PLACEHOLDER_PRICING_NOTE}</p>
        </div>

        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {rows.map((plan) => (
            <section key={plan.id} className="card flex flex-col p-6" aria-label={`${plan.name} plan`}>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{plan.name}</h2>
              <p className="mt-3 text-3xl font-semibold">{plan.priceLabel}</p>
              <p className="mt-3 flex-1 text-sm text-muted">{plan.blurb}</p>
              <ul className="mt-5 space-y-2 text-sm">
                <li>
                  <span className="font-medium">{plan.seatsLabel}</span>{" "}
                  <span className="text-muted">seats</span>
                </li>
                <li>
                  <span className="font-medium">{formatNumber(plan.sendingAccounts)}</span>{" "}
                  <span className="text-muted">sending accounts</span>
                </li>
                <li>
                  <span className="font-medium">{formatNumber(plan.monthlySends)}</span>{" "}
                  <span className="text-muted">sends per month</span>
                </li>
              </ul>
              <Link href={ctaHref} className="btn-primary mt-6 text-center">
                {plan.id === "FREE" && !session ? "Start free" : ctaLabel}
              </Link>
            </section>
          ))}
        </div>

        <section className="card mt-12 overflow-x-auto p-0" aria-label="Plan comparison">
          <table className="w-full min-w-[560px] text-left text-sm">
            <caption className="px-6 pt-5 text-left text-base font-semibold">
              Plan comparison
            </caption>
            <thead>
              <tr className="border-b border-line text-muted">
                <th className="px-6 py-3 font-medium">Plan</th>
                <th className="px-4 py-3 font-medium">Price</th>
                <th className="px-4 py-3 font-medium">Seats</th>
                <th className="px-4 py-3 font-medium">Sending accounts</th>
                <th className="px-4 py-3 font-medium">Monthly sends</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((plan) => (
                <tr key={plan.id} className="border-b border-line last:border-0">
                  <td className="px-6 py-3 font-medium">{plan.name}</td>
                  <td className="px-4 py-3">{plan.priceLabel}</td>
                  <td className="px-4 py-3">{plan.seatsLabel}</td>
                  <td className="px-4 py-3">{formatNumber(plan.sendingAccounts)}</td>
                  <td className="px-4 py-3">{formatNumber(plan.monthlySends)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-6 pb-5 pt-3 text-xs text-muted">
            Limits are enforced by the quota engine: a campaign that would exceed the monthly send
            volume fails preflight with the exact numbers. {PLACEHOLDER_PRICING_NOTE}
          </p>
        </section>

        <div className="mt-12 text-center">
          <Link href={ctaHref} className="btn-primary">
            {ctaLabel}
          </Link>
          <p className="mt-3 text-sm text-muted">
            Questions about plans? The billing page inside the app shows your current plan, this
            month&apos;s usage, and the upgrade options available to your workspace.
          </p>
        </div>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-6 text-sm text-muted">
          <span>ColdReach. Cold outreach, run carefully.</span>
          <nav className="flex gap-5">
            <Link href="/pricing" className="hover:text-primary">
              Pricing
            </Link>
            <Link href="/signup" className="hover:text-primary">
              Get started
            </Link>
            <Link href="/login" className="hover:text-primary">
              Sign in
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
