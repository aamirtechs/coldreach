import { redirect } from "next/navigation";

/**
 * The Outbox was renamed to Sent in v1.29.0. This route keeps old
 * bookmarks and links working by redirecting to /app/sent with the
 * filter query string preserved.
 */
export default async function OutboxRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") {
      query.set(key, value);
    }
  }
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  redirect(`/app/sent${suffix}`);
}
