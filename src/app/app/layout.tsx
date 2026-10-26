import { redirect } from "next/navigation";
import { Building2 } from "lucide-react";
import { getSessionWorkspace } from "@/lib/auth/session";
import { Sidebar } from "@/components/Sidebar";
import { ThemeToggle } from "@/components/ThemeToggle";
import { UserMenu } from "@/components/UserMenu";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSessionWorkspace();
  if (!session) {
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-line bg-surface px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent font-display text-xs font-bold text-white md:hidden">
              CR
            </span>
            {/*
              Workspace switcher placeholder. Multi-workspace switching lands
              in Phase 3; until then this shows the active workspace and is
              deliberately not interactive.
            */}
            <div
              className="flex items-center gap-2 rounded-lg border border-line bg-elevated px-3 py-1.5"
              title="Workspace switching arrives in Phase 3"
            >
              <Building2 className="h-4 w-4 text-muted" />
              <span className="max-w-48 truncate text-sm font-medium">
                {session.workspace.name}
              </span>
              <span className="hidden rounded bg-surface px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted lg:inline">
                Active workspace
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <UserMenu
              name={session.user.name}
              email={session.user.email}
              role={session.role}
            />
          </div>
        </header>
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
