import Link from "next/link";
import * as Icons from "lucide-react";
import { Card } from "@/components/ui/card";
import { getCategories } from "@/lib/api/catalog";

export async function CategoryGrid() {
  const categories = await getCategories();

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
      {categories.map((category) => {
        const Icon =
          (Icons[category.icon as keyof typeof Icons] as Icons.LucideIcon) ??
          Icons.ShoppingBasket;
        return (
          <Link key={category.id} href={`/categories/${category.slug}`}>
            <Card className="flex flex-col items-center gap-2 p-4 text-center transition-colors hover:border-primary">
              <div className="flex size-12 items-center justify-center rounded-full bg-primary/10">
                <Icon className="size-6 text-primary" />
              </div>
              <span className="text-xs font-medium sm:text-sm">
                {category.name}
              </span>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}
