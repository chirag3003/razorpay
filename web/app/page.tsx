import Link from "next/link";
import { Button } from "@/components/ui/button";
import { HeroCarousel } from "@/components/home/hero-carousel";
import { CategoryGrid } from "@/components/home/category-grid";
import { PromoStrip } from "@/components/home/promo-strip";
import { ProductCarousel } from "@/components/product/product-carousel";
import { getFeaturedProducts, getNewArrivals } from "@/lib/api/catalog";

export default async function Home() {
  const [featured, newArrivals] = await Promise.all([
    getFeaturedProducts(10),
    getNewArrivals(10),
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

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-heading text-xl font-semibold">Bestsellers</h2>
          <Button
            variant="link"
            nativeButton={false}
            render={<Link href="/products?tag=bestseller" />}
          >
            View all
          </Button>
        </div>
        <ProductCarousel products={featured} />
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-heading text-xl font-semibold">New Arrivals</h2>
          <Button
            variant="link"
            nativeButton={false}
            render={<Link href="/products?tag=new" />}
          >
            View all
          </Button>
        </div>
        <ProductCarousel products={newArrivals} />
      </section>
    </div>
  );
}
