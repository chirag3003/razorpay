"use client";

import { useState } from "react";
import Link from "next/link";
import * as Icons from "lucide-react";
import { Menu, Heart, PackageCheck, UserCircle, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { getCategories } from "@/lib/queries";

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const categories = getCategories();

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Open menu"
        className="md:hidden"
        onClick={() => setOpen(true)}
      >
        <Menu className="size-5" />
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="flex flex-col gap-0 p-0">
          <SheetHeader className="border-b p-4">
            <SheetTitle>
              <Link
                href="/"
                onClick={() => setOpen(false)}
                className="font-heading text-lg font-semibold text-primary"
              >
                FreshCart
              </Link>
            </SheetTitle>
          </SheetHeader>

          <div className="flex flex-col gap-1 p-2">
            <MobileLink href="/account" onClick={() => setOpen(false)} icon={UserCircle}>
              Account
            </MobileLink>
            <MobileLink href="/orders" onClick={() => setOpen(false)} icon={PackageCheck}>
              Orders
            </MobileLink>
            <MobileLink href="/wishlist" onClick={() => setOpen(false)} icon={Heart}>
              Wishlist
            </MobileLink>
            <MobileLink href="/login" onClick={() => setOpen(false)} icon={LogIn}>
              Login / Sign up
            </MobileLink>
          </div>

          <Separator />

          <div className="flex flex-col gap-1 overflow-y-auto p-2">
            <p className="px-3 py-1.5 text-xs font-medium text-muted-foreground">
              Shop by category
            </p>
            {categories.map((category) => {
              const Icon =
                (Icons[
                  category.icon as keyof typeof Icons
                ] as Icons.LucideIcon) ?? Icons.ShoppingBasket;
              return (
                <MobileLink
                  key={category.id}
                  href={`/categories/${category.slug}`}
                  onClick={() => setOpen(false)}
                  icon={Icon}
                >
                  {category.name}
                </MobileLink>
              );
            })}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

function MobileLink({
  href,
  icon: Icon,
  children,
  onClick,
}: {
  href: string;
  icon: Icons.LucideIcon;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium hover:bg-muted"
    >
      <Icon className="size-4 text-muted-foreground" />
      {children}
    </Link>
  );
}
