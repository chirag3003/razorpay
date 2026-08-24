"use client";

import { useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ProductFilters } from "@/components/product/product-filters";
import type { Category } from "@/lib/types";

export function MobileFilters({ categories }: { categories: Category[] }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="lg:hidden"
        onClick={() => setOpen(true)}
      >
        <SlidersHorizontal className="size-4" />
        Filters
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="gap-0 p-0">
          <SheetHeader className="border-b p-4">
            <SheetTitle>Filters</SheetTitle>
          </SheetHeader>
          <ScrollArea className="flex-1 p-4">
            <ProductFilters categories={categories} />
          </ScrollArea>
        </SheetContent>
      </Sheet>
    </>
  );
}
