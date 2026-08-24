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
import { ProductSort } from "@/components/product/product-sort";
import { ProductPagination } from "@/components/product/product-pagination";
import { getCategoryBySlug, getCategories, getProducts } from "@/lib/queries";
import { toArray, toNumber, toURLSearchParams } from "@/lib/search-params";
import type { RawSearchParams } from "@/lib/search-params";
import type { SortOption } from "@/lib/types";

const PAGE_SIZE = 12;

export function generateStaticParams() {
  return getCategories().map((category) => ({ slug: category.slug }));
}

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<RawSearchParams>;
}) {
  const { slug } = await params;
  const category = getCategoryBySlug(slug);

  if (!category) {
    notFound();
  }

  const raw = await searchParams;
  const tags = toArray(raw.tag);
  const inStockOnly = raw.inStock === "1";
  const sort = (raw.sort as SortOption | undefined) ?? "popularity";
  const page = Math.max(1, toNumber(raw.page) ?? 1);

  const allResults = getProducts({
    categorySlugs: [slug],
    tags,
    inStockOnly,
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

      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {allResults.length} product{allResults.length !== 1 && "s"}
        </p>
        <ProductSort />
      </div>

      <ProductGrid products={results} />

      <div className="pt-4">
        <ProductPagination
          pathname={`/categories/${slug}`}
          searchParams={toURLSearchParams(raw)}
          page={currentPage}
          totalPages={totalPages}
        />
      </div>
    </div>
  );
}
