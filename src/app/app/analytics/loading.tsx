/** Loading skeleton for analytics, matching the table layout. */
export default function AnalyticsLoading() {
  return (
    <div className="mx-auto max-w-6xl" aria-busy="true" aria-label="Loading analytics">
      <div className="h-8 w-44 animate-pulse rounded bg-elevated" />
      <div className="mt-2 h-4 w-96 max-w-full animate-pulse rounded bg-elevated" />
      <div className="card mt-6 p-4">
        <div className="h-4 w-full animate-pulse rounded bg-elevated" />
        {[0, 1, 2, 3].map((row) => (
          <div key={row} className="mt-4 h-4 w-full animate-pulse rounded bg-elevated" />
        ))}
      </div>
    </div>
  );
}
