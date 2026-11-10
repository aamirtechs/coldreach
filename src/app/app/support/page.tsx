import { redirect } from "next/navigation";
import Link from "next/link";
import { getSessionWorkspace } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { listWorkspaceTickets, supportEmail } from "@/lib/support/tickets";
import { SUPPORT_WHATSAPP_DISPLAY, supportWhatsAppLink } from "@/lib/support/constants";
import { SupportTicketForm } from "@/components/support/SupportTicketForm";

export const dynamic = "force-dynamic";

export default async function SupportPage() {
  const session = await getSessionWorkspace();
  if (!session) {
    redirect("/login");
  }
  const tickets = await listWorkspaceTickets(prisma, session.workspace.id);
  const email = supportEmail();

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="font-display text-2xl font-semibold tracking-tight">Support</h1>
      <p className="mt-1 text-sm text-muted">
        Get help with sending, billing, or your account. Create a ticket below, or reach us
        directly on WhatsApp or email.
      </p>

      <section className="card mt-6 p-6">
        <h2 className="font-display text-lg font-semibold">Contact options</h2>
        <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          <p>
            <span className="font-medium">WhatsApp:</span>{" "}
            <Link
              href={supportWhatsAppLink()}
              target="_blank"
              rel="noreferrer"
              className="text-accent underline"
            >
              {SUPPORT_WHATSAPP_DISPLAY}
            </Link>
            <span className="mt-1 block text-muted">
              Fastest for quick questions during support hours.
            </span>
          </p>
          <p>
            <span className="font-medium">Email:</span>{" "}
            <Link href={`mailto:${email}`} className="text-accent underline">
              {email}
            </Link>
            <span className="mt-1 block text-muted">
              Tickets and email both land in the same inbox.
            </span>
          </p>
        </div>
      </section>

      <div className="mt-6">
        <SupportTicketForm />
      </div>

      <section className="card mt-6 p-6">
        <h2 className="font-display text-lg font-semibold">Your tickets</h2>
        {tickets.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No tickets yet. Your tickets will appear here.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted">
                  <th className="py-2 pr-3 font-medium">Subject</th>
                  <th className="py-2 pr-3 font-medium">Category</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {tickets.map((ticket) => (
                  <tr key={ticket.id} className="border-t border-line">
                    <td className="py-2 pr-3 font-medium">{ticket.subject}</td>
                    <td className="py-2 pr-3 text-muted">{ticket.category}</td>
                    <td className="py-2 pr-3">{ticket.status}</td>
                    <td className="py-2 text-muted">{ticket.createdAt.toISOString().slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
