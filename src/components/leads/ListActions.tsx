"use client";

import { useRouter } from "next/navigation";

export function ListActions({ listId, listName }: { listId: string; listName: string }) {
  const router = useRouter();

  async function deleteList() {
    if (
      !window.confirm(
        `Delete the list "${listName}"? The leads stay in the workspace; only the list grouping is removed.`,
      )
    ) {
      return;
    }
    const response = await fetch(`/api/lead-lists/${listId}`, { method: "DELETE" });
    if (response.ok) {
      router.push("/app/leads");
    }
  }

  return (
    <div className="flex flex-wrap gap-3">
      <a className="btn-secondary" href={`/api/lead-lists/${listId}/export`}>
        Export CSV
      </a>
      <button type="button" className="btn-ghost" onClick={deleteList}>
        Delete list
      </button>
    </div>
  );
}
