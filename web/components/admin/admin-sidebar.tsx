"use client";

import Link from "next/link";
import { Leaf, Store } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AdminNav } from "@/components/admin/admin-nav";
import { cn } from "@/lib/utils";

/** The rail contents, shared verbatim by the desktop column and the mobile sheet. */
export function AdminSidebar({
  className,
  onNavigate,
}: {
  className?: string;
  onNavigate?: () => void;
}) {
  return (
    <div className={cn("flex flex-col", className)}>
      <Link
        href="/admin"
        onClick={onNavigate}
        className="flex items-center gap-2 border-b border-sidebar-border px-4 py-4"
      >
        <Leaf className="size-5 text-primary" />
        <span className="font-heading text-lg font-semibold">FreshCart</span>
        <Badge variant="secondary" className="ml-auto">
          Admin
        </Badge>
      </Link>

      <ScrollArea className="flex-1">
        <AdminNav onNavigate={onNavigate} />
      </ScrollArea>

      <div className="border-t border-sidebar-border p-3">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start"
          nativeButton={false}
          render={<Link href="/" onClick={onNavigate} />}
        >
          <Store className="size-4" />
          View storefront
        </Button>
      </div>
    </div>
  );
}
