"use client";

import { Loader2, type LucideIcon } from "lucide-react";
import { TableCell, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";

/**
 * Renders the loading / failed / empty triad as a single full-width table row,
 * so every admin table handles those states identically. Returns null when
 * there's real data to show.
 */
export function AdminTableState({
  colSpan,
  loading,
  failed,
  isEmpty,
  onRetry,
  emptyIcon: EmptyIcon,
  emptyTitle = "Nothing to show",
  emptyDescription,
}: {
  colSpan: number;
  loading: boolean;
  failed: boolean;
  isEmpty: boolean;
  onRetry?: () => void;
  emptyIcon?: LucideIcon;
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  if (loading) {
    return (
      <TableRow className="hover:bg-transparent">
        <TableCell colSpan={colSpan} className="h-48 text-center">
          <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
        </TableCell>
      </TableRow>
    );
  }

  if (failed) {
    return (
      <TableRow className="hover:bg-transparent">
        <TableCell colSpan={colSpan} className="h-48 text-center">
          <div className="flex flex-col items-center gap-2">
            <p className="text-sm font-medium">We couldn&apos;t load this</p>
            <p className="text-sm text-muted-foreground">
              The server didn&apos;t respond. Please try again in a moment.
            </p>
            {onRetry && (
              <Button size="sm" variant="outline" className="mt-1" onClick={onRetry}>
                Try again
              </Button>
            )}
          </div>
        </TableCell>
      </TableRow>
    );
  }

  if (isEmpty) {
    return (
      <TableRow className="hover:bg-transparent">
        <TableCell colSpan={colSpan} className="h-48 text-center">
          <div className="flex flex-col items-center gap-2">
            {EmptyIcon && (
              <div className="flex size-10 items-center justify-center rounded-full bg-muted">
                <EmptyIcon className="size-5 text-muted-foreground" />
              </div>
            )}
            <p className="text-sm font-medium">{emptyTitle}</p>
            {emptyDescription && (
              <p className="max-w-xs text-sm text-muted-foreground">
                {emptyDescription}
              </p>
            )}
          </div>
        </TableCell>
      </TableRow>
    );
  }

  return null;
}
