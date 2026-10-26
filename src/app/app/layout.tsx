import { redirect } from "next/navigation";
import { getSessionWorkspace } from "@/lib/auth/session";
import { listUserWorkspaces } from "@/lib/auth/workspaces";
import { Sidebar } from "@/components/Sidebar";
import { ThemeToggle } from "@/components/ThemeToggle";
import { UserMenu } from "@/components/UserMenu";
import { WorkspaceSwitcher } from "@/components/WorkspaceSwitcher";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSessionWorkspace();
  if (!session) {
    redirect("/login");
  }
  const workspaces = await listUserWorkspaces(session.user.id);

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-line bg-surface px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent font-display text-xs font-bold text-white md:hidden">
              CR
            </span>
            <WorkspaceSwitcher
              workspaces={workspaces}
              activeId={session.workspace.id}
              activeName={session.workspace.name}
            />
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
