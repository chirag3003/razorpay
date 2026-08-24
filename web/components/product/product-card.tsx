import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PriceTag } from "@/components/product/price-tag";
import { AddToCartButton } from "@/components/product/add-to-cart-button";
import { WishlistButton } from "@/components/product/wishlist-button";
import type { Product } from "@/lib/types";

export function ProductCard({ product }: { product: Product }) {
  return (
    <Card className="group relative flex flex-col gap-2.5 overflow-hidden p-2.5">
      <div className="relative aspect-square overflow-hidden rounded-lg bg-muted">
        <Link href={`/products/${product.slug}`} className="block size-full">
          <img
            src={product.image}
            alt={product.name}
            loading="lazy"
            className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        </Link>
        <WishlistButton
          productId={product.id}
          className="absolute top-1.5 right-1.5"
        />
        {product.tags.includes("bestseller") && (
          <Badge className="absolute top-1.5 left-1.5 bg-amber-500 text-white">
            Bestseller
          </Badge>
        )}
        {!product.inStock && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/70">
            <Badge variant="secondary">Out of stock</Badge>
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1 px-0.5">
        <Link href={`/products/${product.slug}`} className="space-y-0.5">
          <p className="line-clamp-2 text-sm leading-snug font-medium">
            {product.name}
          </p>
          <p className="text-xs text-muted-foreground">{product.unit}</p>
        </Link>
      </div>

      <div className="flex items-end justify-between gap-2 px-0.5">
        <PriceTag price={product.price} mrp={product.mrp} />
      </div>
      <AddToCartButton
        productId={product.id}
        productName={product.name}
        disabled={!product.inStock}
        className="w-full"
      />
    </Card>
  );
}
