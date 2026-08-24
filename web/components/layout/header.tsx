"use client";

import Link from "next/link";
import { Search as SearchIcon } from "lucide-react";
import { MobileNav } from "@/components/layout/mobile-nav";
import { DeliveryLocation } from "@/components/layout/delivery-location";
import { AccountMenu } from "@/components/layout/account-menu";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { CategoryNav } from "@/components/layout/category-nav";
import { CartSheet } from "@/components/cart/cart-sheet";
import { SearchCommand } from "@/components/common/search-command";
import { Button } from "@/components/ui/button";

export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/80">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3">
        <MobileNav />

        <Link href="/" className="flex shrink-0 items-center gap-1.5">
          <span className="font-heading text-xl font-bold text-primary">
            FreshCart
          </span>
        </Link>

        <DeliveryLocation />

        <div className="hidden flex-1 md:block">
          <SearchCommand />
        </div>

        <div className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Search"
            className="md:hidden"
            onClick={() => {
              document.dispatchEvent(
                new KeyboardEvent("keydown", { key: "k", metaKey: true })
              );
            }}
          >
            <SearchIcon className="size-5" />
          </Button>
          <ThemeToggle />
          <AccountMenu />
          <CartSheet />
        </div>
      </div>
      <div className="mx-auto hidden max-w-7xl px-4 pb-2 md:block">
        <CategoryNav />
      </div>
    </header>
  );
}
