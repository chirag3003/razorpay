import { notFound } from "next/navigation";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { ProductGrid } from "@/components/product/product-grid";
import { ErrorState } from "@/components/common/error-state";
import { ProductSort } from "@/components/product/product-sort";
import { ProductPagination } from "@/components/product/product-pagination";
import { getCategoryBySlug, getProducts } from "@/lib/api/catalog";
import {
  toArray, toNumber, toURLSearchParams,
  redirectIfPageOutOfRange,
} from "@/lib/search-params";
import type { RawSearchParams } from "@/lib/search-params";
import type { SortOption } from "@/lib/types";

const PAGE_SIZE = 12;

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<RawSearchParams>;
}) {
  const { slug } = await params;
  const category = await getCategoryBySlug(slug);

  if (!category) {
    notFound();
  }

  const raw = await searchParams;
  const tags = toArray(raw.tag);
  const inStockOnly = raw.inStock === "1";
  const sort = (raw.sort as SortOption | undefined) ?? "popularity";
  const page = Math.max(1, toNumber(raw.page) ?? 1);

  // Degrade per section, as app/(shop)/page.tsx does: a 5xx or a dropped
  // connection on the listing shouldn't take the category header down with it.
  const products = await getProducts({
    categorySlugs: [slug],
    tags,
    inStockOnly,
    sort,
    page,
    pageSize: PAGE_SIZE,
  }).catch(() => null);

  const total = products?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (products) {
    redirectIfPageOutOfRange(`/categories/${slug}`, raw, page, totalPages);
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <Breadcrumb className="mb-4">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/">Home</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{category.name}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="mb-6 flex flex-col gap-4 overflow-hidden rounded-2xl bg-muted sm:flex-row sm:items-center">
        <div className="aspect-[3/1] w-full overflow-hidden sm:aspect-auto sm:h-40 sm:w-64">
          <img
            src={category.image}
            alt={category.name}
            className="size-full object-cover"
          />
        </div>
        <div className="space-y-1 p-4 sm:p-0">
          <h1 className="font-heading text-2xl font-semibold">
            {category.name}
          </h1>
          <p className="text-sm text-muted-foreground">
            {category.description}
          </p>
        </div>
      </div>

      {products === null ? (
        <ErrorState
          title="Couldn't load these products"
          description="We couldn't reach the server. This is usually temporary — please try again in a moment."
        />
      ) : (
        <>
          <div className="mb-4 flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {total} product{total !== 1 && "s"}
            </p>
            <ProductSort />
          </div>

          <ProductGrid products={products.items} />

          <div className="pt-4">
            <ProductPagination
              pathname={`/categories/${slug}`}
              searchParams={toURLSearchParams(raw)}
              page={page}
              totalPages={totalPages}
            />
          </div>
        </>
      )}
    </div>
  );
}
