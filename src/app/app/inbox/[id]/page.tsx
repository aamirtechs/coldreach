import { ThreadView } from "@/components/inbox/ThreadView";

export const dynamic = "force-dynamic";

export default async function ThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ThreadView threadId={id} />;
}
