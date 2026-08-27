import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { AdminTopbar } from "@/components/admin/admin-topbar";

export function AdminShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh w-full flex-1">
      <AdminSidebar className="sticky top-0 hidden h-svh w-60 shrink-0 border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex" />
      {/* min-w-0 is load-bearing: a flex child defaults to min-width:auto, which
          would let a wide table stretch the row instead of scrolling inside its
          own overflow-x container. */}
      <div className="flex min-w-0 flex-1 flex-col">
        <AdminTopbar />
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
