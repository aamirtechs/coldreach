/** Loading skeleton for the inbox, matching the list layout. */
export default function InboxLoading() {
  return (
    <div className="mx-auto max-w-6xl" aria-busy="true" aria-label="Loading inbox">
      <div className="h-8 w-40 animate-pulse rounded bg-elevated" />
      <div className="mt-2 h-4 w-72 animate-pulse rounded bg-elevated" />
      <div className="card mt-6 divide-y divide-line">
        {[0, 1, 2, 3, 4].map((row) => (
          <div key={row} className="flex items-center gap-4 px-4 py-3">
            <div className="h-4 w-48 animate-pulse rounded bg-elevated" />
            <div className="h-4 flex-1 animate-pulse rounded bg-elevated" />
            <div className="h-4 w-20 animate-pulse rounded bg-elevated" />
          </div>
        ))}
      </div>
    </div>
  );
}
