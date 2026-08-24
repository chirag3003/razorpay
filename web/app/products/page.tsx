import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { ProductGrid } from "@/components/product/product-grid";
import { ProductFilters } from "@/components/product/product-filters";
import { ProductSort } from "@/components/product/product-sort";
import { ProductPagination } from "@/components/product/product-pagination";
import { MobileFilters } from "@/components/product/mobile-filters";
import { getCategories, getProducts } from "@/lib/queries";
import { toArray, toNumber, toSingle, toURLSearchParams } from "@/lib/search-params";
import type { RawSearchParams } from "@/lib/search-params";
import type { SortOption } from "@/lib/types";

const PAGE_SIZE = 12;

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const raw = await searchParams;
  const categories = getCategories();

  const categorySlugs = toArray(raw.category);
  const tags = toArray(raw.tag);
  const query = toSingle(raw.q) ?? "";
  const inStockOnly = raw.inStock === "1";
  const minPrice = toNumber(raw.min);
  const maxPrice = toNumber(raw.max);
  const sort = (toSingle(raw.sort) as SortOption | undefined) ?? "popularity";
  const page = Math.max(1, toNumber(raw.page) ?? 1);

  const allResults = getProducts({
    categorySlugs,
    tags,
    query,
    inStockOnly,
    minPrice,
    maxPrice,
    sort,
  });

  const totalPages = Math.max(1, Math.ceil(allResults.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const results = allResults.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  );

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <Breadcrumb className="mb-4">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/">Home</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>
              {query ? `Results for "${query}"` : "All Products"}
            </BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[220px_1fr]">
        <aside className="hidden lg:block">
          <ProductFilters categories={categories} />
        </aside>

        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {allResults.length} product{allResults.length !== 1 && "s"}{" "}
              {query && <>for &quot;{query}&quot;</>}
            </p>
            <div className="flex items-center gap-2">
              <MobileFilters categories={categories} />
              <ProductSort />
            </div>
          </div>

          <ProductGrid products={results} />

          <div className="pt-4">
            <ProductPagination
              pathname="/products"
              searchParams={toURLSearchParams(raw)}
              page={currentPage}
              totalPages={totalPages}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
