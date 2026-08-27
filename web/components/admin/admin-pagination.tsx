"use client";

import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
} from "@/components/ui/pagination";

/**
 * Page numbers to render, with `null` marking an elided run.
 * Always shows the first and last page plus a window around the current one.
 */
function buildPages(page: number, totalPages: number): (number | null)[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  const pages = new Set<number>([1, totalPages, page]);
  if (page - 1 > 1) pages.add(page - 1);
  if (page + 1 < totalPages) pages.add(page + 1);
  if (page <= 3) pages.add(2).add(3).add(4);
  if (page >= totalPages - 2)
    pages.add(totalPages - 1).add(totalPages - 2).add(totalPages - 3);

  const sorted = [...pages]
    .filter((p) => p >= 1 && p <= totalPages)
    .sort((a, b) => a - b);

  const withGaps: (number | null)[] = [];
  let previous = 0;
  for (const current of sorted) {
    if (previous && current - previous > 1) withGaps.push(null);
    withGaps.push(current);
    previous = current;
  }
  return withGaps;
}

export function AdminPagination({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2">
      <p className="text-xs text-muted-foreground">
        {total === 0 ? "No results" : `Showing ${from}–${to} of ${total}`}
      </p>

      {totalPages > 1 && (
        <Pagination className="mx-0 w-auto justify-end">
          <PaginationContent>
            <PaginationItem>
              <Button
                variant="ghost"
                size="sm"
                aria-label="Go to previous page"
                disabled={page <= 1}
                onClick={() => onPageChange(page - 1)}
              >
                <ChevronLeftIcon data-icon="inline-start" />
                <span className="hidden sm:block">Previous</span>
              </Button>
            </PaginationItem>

            {buildPages(page, totalPages).map((entry, index) =>
              entry === null ? (
                <PaginationItem key={`gap-${index}`}>
                  <PaginationEllipsis />
                </PaginationItem>
              ) : (
                <PaginationItem key={entry}>
                  <Button
                    variant={entry === page ? "outline" : "ghost"}
                    size="icon-sm"
                    aria-label={`Go to page ${entry}`}
                    aria-current={entry === page ? "page" : undefined}
                    onClick={() => onPageChange(entry)}
                  >
                    {entry}
                  </Button>
                </PaginationItem>
              )
            )}

            <PaginationItem>
              <Button
                variant="ghost"
                size="sm"
                aria-label="Go to next page"
                disabled={page >= totalPages}
                onClick={() => onPageChange(page + 1)}
              >
                <span className="hidden sm:block">Next</span>
                <ChevronRightIcon data-icon="inline-end" />
              </Button>
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
    </div>
  );
}
