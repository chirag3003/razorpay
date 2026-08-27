"use client";

import { Heart } from "lucide-react";
import { ProductGrid } from "@/components/product/product-grid";
import { EmptyState } from "@/components/common/empty-state";
import { useWishlistProducts } from "@/store/wishlist-store";

export default function WishlistPage() {
  const products = useWishlistProducts();

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <h1 className="mb-6 font-heading text-2xl font-semibold">
        My Wishlist
      </h1>
      {products.length === 0 ? (
        <EmptyState
          icon={Heart}
          title="Your wishlist is empty"
          description="Save products you love and find them here later."
          action={{ label: "Explore products", href: "/products" }}
        />
      ) : (
        <ProductGrid products={products} />
      )}
    </div>
  );
}
