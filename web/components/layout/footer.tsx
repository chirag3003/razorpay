"use client";

import Link from "next/link";
import { Sprout, Truck, ShieldCheck, Wallet } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { getCategories } from "@/lib/queries";

const perks = [
  { icon: Truck, label: "Fast delivery", description: "Delivered in under 60 minutes" },
  { icon: Sprout, label: "Farm fresh", description: "Sourced daily from local farms" },
  { icon: ShieldCheck, label: "Quality assured", description: "100% freshness guarantee" },
  { icon: Wallet, label: "Best prices", description: "Great deals every day" },
];

export function Footer() {
  const categories = getCategories().slice(0, 6);

  return (
    <footer className="mt-16 border-t bg-muted/40">
      <div className="mx-auto max-w-7xl px-4 py-8">
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
          {perks.map((perk) => (
            <div key={perk.label} className="flex items-start gap-2.5">
              <perk.icon className="mt-0.5 size-5 shrink-0 text-primary" />
              <div>
                <p className="text-sm font-medium">{perk.label}</p>
                <p className="text-xs text-muted-foreground">
                  {perk.description}
                </p>
              </div>
            </div>
          ))}
        </div>

        <Separator className="my-8" />

        <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
          <div className="col-span-2 space-y-3 sm:col-span-1">
            <span className="font-heading text-lg font-bold text-primary">
              FreshCart
            </span>
            <p className="text-sm text-muted-foreground">
              Groceries delivered fresh to your doorstep, every day.
            </p>
          </div>

          <FooterLinks
            title="Shop"
            links={categories.map((category) => ({
              label: category.name,
              href: `/categories/${category.slug}`,
            }))}
          />

          <FooterLinks
            title="Account"
            links={[
              { label: "My Account", href: "/account" },
              { label: "Orders", href: "/orders" },
              { label: "Wishlist", href: "/wishlist" },
              { label: "Cart", href: "/cart" },
            ]}
          />

          <div className="space-y-3">
            <p className="text-sm font-semibold">Stay updated</p>
            <p className="text-sm text-muted-foreground">
              Get offers and updates in your inbox.
            </p>
            <form
              className="flex gap-2"
              onSubmit={(event) => event.preventDefault()}
            >
              <Input type="email" placeholder="Email address" className="h-9" />
              <Button type="submit" size="sm">
                Join
              </Button>
            </form>
          </div>
        </div>

        <Separator className="my-8" />

        <p className="text-center text-xs text-muted-foreground">
          &copy; {new Date().getFullYear()} FreshCart. All rights reserved.
        </p>
      </div>
    </footer>
  );
}

function FooterLinks({
  title,
  links,
}: {
  title: string;
  links: { label: string; href: string }[];
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold">{title}</p>
      <ul className="space-y-2">
        {links.map((link) => (
          <li key={link.href}>
            <Link
              href={link.href}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
