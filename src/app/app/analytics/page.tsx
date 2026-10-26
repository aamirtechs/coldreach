import { PhasePlaceholder } from "@/components/PhasePlaceholder";

export default function AnalyticsPage() {
  return (
    <PhasePlaceholder
      title="Analytics"
      phase="Phase 3"
      description="Reporting lands in Phase 3 on top of the metrics engine already built and tested in Phase 1, which computes every number from recorded email events."
      bullets={[
        "Sent, delivered, bounced, replied, positive replies, unsubscribes, and complaints, with each metric defined on the page.",
        "Breakdowns by campaign, sequence step, sending account, and team member.",
        "A/B test comparisons for subject lines and first steps.",
        "Opens shown with an explicit unreliable flag, because mail privacy features distort them.",
        "Trend views over time that account for delayed and duplicated provider events.",
      ]}
    />
  );
}
