"use client";

import { useState } from "react";
import { supportTicketStatusLabel } from "@/lib/support/constants";
import { SupportTicketStatusSelect } from "./SupportTicketStatusButton";
import { SupportTicketThread } from "./SupportTicketThread";

/**
 * Platform admin support tickets table.
 *
 * Server-rendered data arrives as plain rows (dates pre-formatted
 * to ISO strings). Each ticket opens in place: the detail row shows
 * the complete message body plus the reporter, workspace, and
 * timestamps, and the status select on the ticket's row sets Open,
 * Under Process, or Closed through the admin endpoint.
 */

export interface AdminTicketRow {
  id: string;
  subject: string;
  category: string;
  message: string;
  userEmail: string;
  workspaceId: string;
  workspaceName: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

function formatDateTime(iso: string): string {
  return `${iso.slice(0, 16).replace("T", " ")} UTC`;
}

function TicketDetail({ ticket }: { ticket: AdminTicketRow }) {
  return (
    <div className="py-3">
      <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs font-medium text-muted">From</dt>
          <dd className="mt-0.5">{ticket.userEmail}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-muted">Workspace</dt>
          <dd className="mt-0.5">
            {ticket.workspaceName} <span className="text-muted">({ticket.workspaceId})</span>
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-muted">Category</dt>
          <dd className="mt-0.5">{ticket.category}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-muted">Status</dt>
          <dd className="mt-0.5">{supportTicketStatusLabel(ticket.status)}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-muted">Created</dt>
          <dd className="mt-0.5">{formatDateTime(ticket.createdAt)}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-muted">Last updated</dt>
          <dd className="mt-0.5">{formatDateTime(ticket.updatedAt)}</dd>
        </div>
      </dl>
      <p className="mt-4 text-xs font-medium text-muted">Message</p>
      <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{ticket.message}</p>
      <SupportTicketThread ticketId={ticket.id} reporterEmail={ticket.userEmail} />
    </div>
  );
}

export function SupportTicketsAdmin({ tickets }: { tickets: AdminTicketRow[] }) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (tickets.length === 0) {
    return <p className="mt-3 text-sm text-muted">No tickets yet.</p>;
  }

  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-muted">
            <th className="py-2 pr-3 font-medium">Subject</th>
            <th className="py-2 pr-3 font-medium">Category</th>
            <th className="py-2 pr-3 font-medium">From</th>
            <th className="py-2 pr-3 font-medium">Status</th>
            <th className="py-2 pr-3 font-medium">Created</th>
            <th className="py-2 font-medium">Set status</th>
          </tr>
        </thead>
        <tbody>
          {tickets.map((ticket) => {
            const open = openId === ticket.id;
            return [
              <tr key={ticket.id} className="border-t border-line align-top">
                <td className="py-2 pr-3">
                  <span className="font-medium">{ticket.subject}</span>
                  <button
                    type="button"
                    className="mt-0.5 block text-xs text-accent underline"
                    onClick={() => setOpenId(open ? null : ticket.id)}
                    aria-expanded={open}
                  >
                    {open ? "Hide details" : "View details"}
                  </button>
                </td>
                <td className="py-2 pr-3 text-muted">{ticket.category}</td>
                <td className="py-2 pr-3 text-muted">{ticket.userEmail}</td>
                <td className="py-2 pr-3">{supportTicketStatusLabel(ticket.status)}</td>
                <td className="py-2 pr-3 text-muted">{ticket.createdAt.slice(0, 10)}</td>
                <td className="py-2">
                  <SupportTicketStatusSelect ticketId={ticket.id} status={ticket.status} />
                </td>
              </tr>,
              open ? (
                <tr key={`${ticket.id}-detail`} className="border-t border-line bg-elevated/40">
                  <td colSpan={6} className="px-3 py-1">
                    <TicketDetail ticket={ticket} />
                  </td>
                </tr>
              ) : null,
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}
