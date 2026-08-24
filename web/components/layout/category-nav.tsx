import Link from "next/link";
import * as Icons from "lucide-react";
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "@/components/ui/navigation-menu";
import { getCategories } from "@/lib/queries";

export function CategoryNav() {
  const categories = getCategories();
  const quickLinks = categories.slice(0, 5);

  return (
    <NavigationMenu className="max-w-none justify-start">
      <NavigationMenuList>
        <NavigationMenuItem>
          <NavigationMenuTrigger>All Categories</NavigationMenuTrigger>
          <NavigationMenuContent>
            <div className="grid w-[520px] grid-cols-2 gap-1 p-2">
              {categories.map((category) => {
                const Icon =
                  (Icons[
                    category.icon as keyof typeof Icons
                  ] as Icons.LucideIcon) ?? Icons.ShoppingBasket;
                return (
                  <NavigationMenuLink
                    key={category.id}
                    render={<Link href={`/categories/${category.slug}`} />}
                  >
                    <Icon className="size-4 text-primary" />
                    <div className="flex flex-col">
                      <span className="text-sm font-medium">
                        {category.name}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {category.description}
                      </span>
                    </div>
                  </NavigationMenuLink>
                );
              })}
            </div>
          </NavigationMenuContent>
        </NavigationMenuItem>
        {quickLinks.map((category) => (
          <NavigationMenuItem key={category.id}>
            <NavigationMenuLink
              render={<Link href={`/categories/${category.slug}`} />}
              className="h-9"
            >
              {category.name}
            </NavigationMenuLink>
          </NavigationMenuItem>
        ))}
      </NavigationMenuList>
    </NavigationMenu>
  );
}
