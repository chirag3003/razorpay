import { notFound } from "next/navigation";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ProductGallery } from "@/components/product/product-gallery";
import { PriceTag } from "@/components/product/price-tag";
import { AddToCartButton } from "@/components/product/add-to-cart-button";
import { WishlistButton } from "@/components/product/wishlist-button";
import { RatingStars } from "@/components/common/rating-stars";
import { ProductCarousel } from "@/components/product/product-carousel";
import { ErrorState } from "@/components/common/error-state";
import {
  getCategoryBySlug,
  getProductBySlug,
  getRelatedProducts,
} from "@/lib/api/catalog";
import { Truck, ShieldCheck, RotateCcw } from "lucide-react";

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const product = await getProductBySlug(slug);

  if (!product) {
    notFound();
  }

  // Secondary data — never let a failure here blank an otherwise-loadable product
  // page. `related` is null when the call *failed* and [] when there genuinely
  // are none, so the strip can say which rather than silently vanishing.
  const [category, related] = await Promise.all([
    getCategoryBySlug(product.categorySlug).catch(() => null),
    getRelatedProducts(slug, 5).catch(() => null),
  ]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <Breadcrumb className="mb-4">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/">Home</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          {category && (
            <>
              <BreadcrumbItem>
                <BreadcrumbLink href={`/categories/${category.slug}`}>
                  {category.name}
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
            </>
          )}
          <BreadcrumbItem>
            <BreadcrumbPage className="line-clamp-1">
              {product.name}
            </BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <ProductGallery images={product.images} alt={product.name} />

        <div className="space-y-5">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              {product.tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="capitalize">
                  {tag}
                </Badge>
              ))}
            </div>
            <h1 className="font-heading text-2xl font-semibold">
              {product.name}
            </h1>
            <p className="text-sm text-muted-foreground">{product.unit}</p>
            <div className="flex items-center gap-2">
              <RatingStars rating={product.rating} />
              <span className="text-sm text-muted-foreground">
                {product.rating} ({product.ratingCount} reviews)
              </span>
            </div>
          </div>

          <PriceTag price={product.price} mrp={product.mrp} size="lg" />

          <div className="flex items-center gap-3">
            <AddToCartButton
              productId={product.id}
              productName={product.name}
              disabled={!product.inStock}
              className="h-10 flex-1 text-base"
            />
            <WishlistButton
              product={product}
              className="size-10 border"
            />
          </div>

          {!product.inStock && (
            <p className="text-sm font-medium text-destructive">
              Currently out of stock
            </p>
          )}

          <div className="grid grid-cols-1 gap-2 rounded-xl border p-3 sm:grid-cols-3">
            <Perk icon={Truck} label="Delivered in 60 minutes" />
            <Perk icon={ShieldCheck} label="100% freshness guarantee" />
            <Perk icon={RotateCcw} label="Easy 24hr returns" />
          </div>

          <Tabs defaultValue="description">
            <TabsList>
              <TabsTrigger value="description">Description</TabsTrigger>
              <TabsTrigger value="nutrition">Nutrition Info</TabsTrigger>
              <TabsTrigger value="reviews">Reviews</TabsTrigger>
            </TabsList>
            <TabsContent value="description" className="pt-3 text-muted-foreground">
              {product.description}
            </TabsContent>
            <TabsContent value="nutrition" className="pt-3 text-muted-foreground">
              Nutritional information is provided by the manufacturer and may
              vary by batch. Please check the packaging for the most accurate
              details specific to this product.
            </TabsContent>
            <TabsContent value="reviews" className="pt-3 text-muted-foreground">
              This product has an average rating of {product.rating} out of 5
              from {product.ratingCount} customers.
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {(related === null || related.length > 0) && (
        <div className="mt-12 space-y-4">
          <h2 className="font-heading text-xl font-semibold">
            You may also like
          </h2>
          {related === null ? (
            <ErrorState
              compact
              title="Couldn't load related products"
              description="The rest of this page is fine — this section will be back shortly."
            />
          ) : (
            <ProductCarousel products={related} />
          )}
        </div>
      )}
    </div>
  );
}

function Perk({
  icon: Icon,
  label,
}: {
  icon: typeof Truck;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <Icon className="size-4 shrink-0 text-primary" />
      <span>{label}</span>
    </div>
  );
}
