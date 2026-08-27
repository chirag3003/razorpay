import Link from "next/link";
import { Button } from "@/components/ui/button";
import { HeroCarousel } from "@/components/home/hero-carousel";
import { CategoryGrid } from "@/components/home/category-grid";
import { PromoStrip } from "@/components/home/promo-strip";
import { ProductCarousel } from "@/components/product/product-carousel";
import { ErrorState } from "@/components/common/error-state";
import { getFeaturedProducts, getNewArrivals } from "@/lib/api/catalog";
import type { Product } from "@/lib/types";

export default async function Home() {
  // Fetch each section independently so one failing endpoint (e.g. /api/products
  // down while /api/categories is fine) degrades that section only, not the page.
  const [featured, newArrivals] = await Promise.all([
    getFeaturedProducts(10).catch(() => null),
    getNewArrivals(10).catch(() => null),
  ]);

  return (
    <div className="mx-auto max-w-7xl space-y-10 px-4 py-6">
      <HeroCarousel />

      <section className="space-y-4">
        <h2 className="font-heading text-xl font-semibold">
          Shop by Category
        </h2>
        <CategoryGrid />
      </section>

      <PromoStrip />

      <ProductSection title="Bestsellers" href="/products?tag=bestseller" products={featured} />
      <ProductSection title="New Arrivals" href="/products?tag=new" products={newArrivals} />
    </div>
  );
}

function ProductSection({
  title,
  href,
  products,
}: {
  title: string;
  href: string;
  products: Product[] | null;
}) {
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-xl font-semibold">{title}</h2>
        <Button
          variant="link"
          nativeButton={false}
          render={<Link href={href} />}
        >
          View all
        </Button>
      </div>
      {products === null ? (
        <ErrorState
          compact
          title="Couldn't load this section"
          description="We couldn't load these products right now. Please try again shortly."
          action={{ label: "Browse all products", href: "/products" }}
        />
      ) : (
        <ProductCarousel products={products} />
      )}
    </section>
  );
}
