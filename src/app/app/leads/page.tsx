import { PhasePlaceholder } from "@/components/PhasePlaceholder";

export default function LeadsPage() {
  return (
    <PhasePlaceholder
      title="Leads"
      phase="Phase 2"
      description="Lead management lands in Phase 2 on top of the import engine that already exists in Phase 1: address normalisation, validation, and deduplication are implemented and tested."
      bullets={[
        "CSV import with a summary report showing kept, duplicate, and invalid rows before anything is saved.",
        "Lead lists with custom fields, tags, filters, and bulk actions.",
        "Per-contact status, campaign enrollment history, and reply history.",
        "Suppression state shown on every contact, with the reason it was suppressed.",
        "CSV export of any list or filtered segment.",
      ]}
    />
  );
}
