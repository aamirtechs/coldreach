import { PhasePlaceholder } from "@/components/PhasePlaceholder";

export default function InboxPage() {
  return (
    <PhasePlaceholder
      title="Inbox"
      phase="Phase 3"
      description="The unified inbox arrives in Phase 3, once provider synchronisation exists. The Thread and ThreadMessage models it will read from are already in the Phase 1 schema."
      bullets={[
        "Replies from every connected sending account in one conversation list.",
        "Filtering by campaign, sender account, contact, and thread status.",
        "Assignment to team members, internal notes, and follow-up tracking.",
        "Reply detection that pauses the matching campaign enrollment immediately.",
        "Optional AI reply classification and suggested responses, always reviewed by a human before sending.",
      ]}
    />
  );
}
