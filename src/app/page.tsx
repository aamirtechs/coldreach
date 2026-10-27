import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Inbox,
  ListChecks,
  Send,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { PLACEHOLDER_PRICING_NOTE, formatNumber, pricingRows } from "@/lib/marketing/pricing";

interface Feature {
  icon: LucideIcon;
  title: string;
  body: string;
}

const FEATURES: Feature[] = [
  {
    icon: Send,
    title: "Campaigns that respect the clock",
    body: "Multi-step sequences with sending windows, timezone aware scheduling, and business day rules, so follow-ups land when people actually read email.",
  },
  {
    icon: ShieldCheck,
    title: "Compliance built in, not bolted on",
    body: "Suppression lists are checked before every send. Unsubscribes and bounces stop sequences automatically. Sender identity stays visible and honest.",
  },
  {
    icon: ListChecks,
    title: "Lead lists without the spreadsheet pain",
    body: "CSV import with deduplication, validation, custom fields, and clear error reports, so a bad import never turns into a bad campaign.",
  },
  {
    icon: Inbox,
    title: "One inbox for every reply",
    body: "Replies from all sending accounts in a single view, organised by campaign and contact, with assignment and notes for the team.",
  },
  {
    icon: BarChart3,
    title: "Analytics that admit what they do not know",
    body: "Delivered, bounced, replied, and booked, computed from real events. Opens are labelled as the imperfect signal they are, never dressed up as fact.",
  },
  {
    icon: Sparkles,
    title: "AI that drafts, you decide",
    body: "Sequence drafts, subject line options, and reply suggestions that a human reviews and edits. AI output is never sent without your approval.",
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent font-display text-sm font-bold text-white">
              CR
            </span>
            <span className="font-display text-lg font-semibold tracking-tight">ColdReach</span>
          </div>
          <nav className="flex items-center gap-2" aria-label="Marketing">
            <ThemeToggle />
            <Link href="/pricing" className="btn-ghost">
              Pricing
            </Link>
            <Link href="/login" className="btn-ghost">
              Sign in
            </Link>
            <Link href="/signup" className="btn-primary">
              Get started
            </Link>
          </nav>
        </div>
      </header>

      <main>
        <section className="mx-auto max-w-6xl px-6 pb-16 pt-20 text-center">
          <h1 className="mx-auto max-w-3xl font-display text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
            Cold email outreach with the guardrails left on
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-muted">
            ColdReach is a campaign platform for sales teams, founders, and lead generation
            agencies. It plans sequences around real sending windows, enforces suppression
            lists before anything leaves, and reports results from actual delivery events.
          </p>
          <div className="mt-8 flex items-center justify-center gap-3">
            <Link href="/signup" className="btn-primary px-5 py-2.5">
              Create your workspace
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/login" className="btn-secondary px-5 py-2.5">
              Sign in
            </Link>
          </div>
          <p className="mt-6 text-sm text-muted">
            No guaranteed inbox placement, ever. Deliverability depends on your domains,
            your lists, and your content. ColdReach gives you the controls and the data,
            not promises nobody can keep.
          </p>
        </section>

        <section className="border-y border-line bg-surface">
          <div className="mx-auto grid max-w-6xl gap-6 px-6 py-16 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature) => {
              const Icon = feature.icon;
              return (
                <article key={feature.title} className="card p-6">
                  <Icon className="h-6 w-6 text-accent" />
                  <h2 className="mt-4 font-display text-lg font-semibold">{feature.title}</h2>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{feature.body}</p>
                </article>
              );
            })}
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 py-16">
          <div className="grid gap-10 lg:grid-cols-2">
            <div>
              <h2 className="font-display text-2xl font-semibold tracking-tight">
                Built for responsible sending
              </h2>
              <p className="mt-3 leading-relaxed text-muted">
                Cold outreach is regulated, and the rules differ by region. ColdReach is
                designed around consent and compliance mechanics rather than around evading
                them.
              </p>
            </div>
            <ul className="space-y-3 text-sm leading-relaxed">
              <li className="card p-4">
                Unsubscribe links in every campaign email, enforced immediately and honoured
                across the whole workspace.
              </li>
              <li className="card p-4">
                Workspace and global suppression lists checked before every single send, so
                a suppressed contact can never be mailed again by accident.
              </li>
              <li className="card p-4">
                SPF, DKIM, and DMARC guidance with DNS verification, so your sending domains
                are set up correctly and stay that way.
              </li>
              <li className="card p-4">
                CAN-SPAM and GDPR oriented workflows, including clear sender identification
                and data deletion support. You remain responsible for the lawfulness of your
                outreach in your jurisdiction.
              </li>
            </ul>
          </div>
        </section>

        <section className="border-t border-line bg-surface">
          <div className="mx-auto max-w-6xl px-6 py-16">
            <h2 className="text-center font-display text-2xl font-semibold tracking-tight">
              Pricing
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-center text-sm leading-relaxed text-muted">
              Four plans, one product. Plans differ only in seats, sending accounts, and
              monthly send volume, and the numbers below come straight from the same plan
              catalog the quota engine enforces.
            </p>
            <p className="mx-auto mt-2 max-w-xl text-center text-xs text-warning">
              {PLACEHOLDER_PRICING_NOTE}
            </p>
            <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {pricingRows().map((plan) => (
                <article key={plan.id} className="card p-6 text-center">
                  <h3 className="font-display text-lg font-semibold">{plan.name}</h3>
                  <p className="mt-2 font-display text-2xl font-semibold">{plan.priceLabel}</p>
                  <p className="mt-2 text-sm leading-relaxed text-muted">
                    {plan.seatsLabel} seats, {formatNumber(plan.sendingAccounts)} sending
                    accounts, {formatNumber(plan.monthlySends)} sends per month.
                  </p>
                </article>
              ))}
            </div>
            <div className="mt-12 flex items-center justify-center gap-3">
              <Link href="/pricing" className="btn-primary px-5 py-2.5">
                See full pricing
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href="/signup" className="btn-secondary px-5 py-2.5">
                Start with the free plan
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-6 py-8 text-sm text-muted sm:flex-row">
          <p>ColdReach. Cold email outreach with guardrails.</p>
          <nav className="flex gap-5" aria-label="Footer">
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
          <p>Send responsibly. Respect unsubscribes. Never fake the numbers.</p>
        </div>
      </footer>
    </div>
  );
}
