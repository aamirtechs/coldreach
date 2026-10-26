import { InboxList } from "@/components/inbox/InboxList";

export const dynamic = "force-dynamic";

export default function InboxPage() {
  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="font-display text-2xl font-semibold tracking-tight">Inbox</h1>
      <p className="mt-1 text-sm text-muted">
        Every reply from every connected sending account in one place. Reply sync runs before
        each worker tick and from the Sync replies button on the Sending Accounts page; a reply
        stops its campaign sequence the moment it is imported. Classifications are rule based
        keyword heuristics, not AI, and can be overridden on any conversation.
      </p>
      <div className="mt-6">
        <InboxList />
      </div>
    </div>
  );
}
