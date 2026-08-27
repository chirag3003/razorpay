"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Archive,
  ArchiveRestore,
  MoreHorizontal,
  PackageSearch,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { AdminSearchInput } from "@/components/admin/admin-search-input";
import { AdminPagination } from "@/components/admin/admin-pagination";
import { AdminTableState } from "@/components/admin/admin-table-state";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { ProductFormSheet } from "@/components/admin/product-form-sheet";
import { useAdminList } from "@/hooks/use-admin-list";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { deleteProduct, getAdminProducts, updateProduct } from "@/lib/api/admin";
import { useAdminAuthStore, handleAdminApiError } from "@/store/admin-auth-store";
import { useAdminCategoriesStore } from "@/store/admin-categories-store";
import { ApiError } from "@/lib/api/client";
import {
  ADMIN_PAGE_SIZE,
  ARCHIVED_FILTERS,
  PRODUCT_SORTS,
} from "@/lib/admin-constants";
import { formatPrice } from "@/lib/utils";
import type {
  AdminProduct,
  AdminProductSort,
  ArchivedFilter,
} from "@/lib/admin-types";

const ALL = "all";
const STOCK_OPTIONS = [
  { value: ALL, label: "Any stock" },
  { value: "true", label: "In stock" },
  { value: "false", label: "Out of stock" },
];

export default function AdminProductsPage() {
  const token = useAdminAuthStore((state) => state.token);
  const categories = useAdminCategoriesStore((state) => state.categories);
  const fetchCategories = useAdminCategoriesStore(
    (state) => state.fetchCategories
  );

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>(ALL);
  const [archived, setArchived] = useState<ArchivedFilter>("exclude");
  const [stock, setStock] = useState<string>(ALL);
  const [sort, setSort] = useState<AdminProductSort>("newest");
  const [page, setPage] = useState(1);
  const debouncedQuery = useDebouncedValue(query);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AdminProduct | undefined>();
  const [deleting, setDeleting] = useState<AdminProduct | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);

  useEffect(() => {
    if (token) fetchCategories(token);
  }, [token, fetchCategories]);

  const { items, total, loading, failed, setItems, reload } = useAdminList(
    getAdminProducts,
    {
      q: debouncedQuery,
      category: category === ALL ? undefined : category,
      archived,
      inStock: stock === ALL ? undefined : stock === "true",
      sort,
      page,
      pageSize: ADMIN_PAGE_SIZE,
    }
  );

  const hasFilters =
    Boolean(query) || category !== ALL || archived !== "exclude" || stock !== ALL;

  function reset<T>(setter: (value: T) => void) {
    return (value: T) => {
      setter(value);
      setPage(1);
    };
  }

  /**
   * Splice the server's copy back into the row, unless the change means the row
   * no longer matches the active filter — then refetch so it correctly leaves.
   */
  function applyUpdate(updated: AdminProduct, ejected: boolean) {
    if (ejected) {
      reload();
      return;
    }
    setItems((current) =>
      current.map((item) => (item.id === updated.id ? updated : item))
    );
  }

  async function toggleStock(product: AdminProduct) {
    if (!token) return;
    setPendingId(product.id);
    try {
      const updated = await updateProduct(token, product.id, {
        inStock: !product.inStock,
      });
      applyUpdate(updated, stock !== ALL);
      toast.success(updated.inStock ? "Marked in stock" : "Marked out of stock");
    } catch (err) {
      if (!handleAdminApiError(err)) {
        toast.error(
          err instanceof ApiError ? err.message : "Couldn't update the product"
        );
      }
    } finally {
      setPendingId(null);
    }
  }

  async function toggleArchived(product: AdminProduct) {
    if (!token) return;
    const nextArchived = !product.archivedAt;
    setPendingId(product.id);
    try {
      const updated = await updateProduct(token, product.id, {
        archived: nextArchived,
      });
      applyUpdate(updated, archived !== "all");
      toast.success(nextArchived ? "Product archived" : "Product restored");
    } catch (err) {
      if (!handleAdminApiError(err)) {
        toast.error(
          err instanceof ApiError ? err.message : "Couldn't update the product"
        );
      }
    } finally {
      setPendingId(null);
    }
  }

  async function confirmDelete() {
    if (!token || !deleting) return;
    setDeletePending(true);
    try {
      const result = await deleteProduct(token, deleting.id);
      if (result.deleted) {
        toast.success("Product deleted");
      } else {
        toast.info(
          "Past orders reference this product, so it was archived instead of deleted."
        );
      }
      setDeleting(null);
      reload();
    } catch (err) {
      if (!handleAdminApiError(err)) {
        toast.error(
          err instanceof ApiError ? err.message : "Couldn't delete the product"
        );
      }
    } finally {
      setDeletePending(false);
    }
  }

  return (
    <div>
      <AdminPageHeader
        title="Products"
        description={`${total} ${total === 1 ? "product" : "products"} matching these filters`}
      >
        <Button
          onClick={() => {
            setEditing(undefined);
            setFormOpen(true);
          }}
        >
          <Plus className="size-4" />
          New product
        </Button>
      </AdminPageHeader>

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="sm:w-56">
          <Label className="mb-1.5 text-xs text-muted-foreground">Search</Label>
          <AdminSearchInput
            value={query}
            onChange={reset(setQuery)}
            placeholder="Search product name…"
          />
        </div>

        <div>
          <Label className="mb-1.5 text-xs text-muted-foreground">Category</Label>
          <Select
            value={category}
            onValueChange={(value) => reset(setCategory)(value as string)}
          >
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All categories</SelectItem>
              {categories.map((option) => (
                <SelectItem key={option.id} value={option.slug}>
                  {option.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="mb-1.5 text-xs text-muted-foreground">Status</Label>
          <Select
            value={archived}
            onValueChange={(value) =>
              reset(setArchived)(value as ArchivedFilter)
            }
          >
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ARCHIVED_FILTERS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="mb-1.5 text-xs text-muted-foreground">Stock</Label>
          <Select value={stock} onValueChange={(value) => reset(setStock)(value as string)}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STOCK_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="mb-1.5 text-xs text-muted-foreground">Sort</Label>
          <Select
            value={sort}
            onValueChange={(value) => reset(setSort)(value as AdminProductSort)}
          >
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRODUCT_SORTS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setQuery("");
              setCategory(ALL);
              setArchived("exclude");
              setStock(ALL);
              setSort("newest");
              setPage(1);
            }}
          >
            Clear filters
          </Button>
        )}
      </div>

      <Card className="overflow-hidden p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-14" />
              <TableHead>Product</TableHead>
              <TableHead>Category</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead>Stock</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            <AdminTableState
              colSpan={6}
              loading={loading}
              failed={failed}
              isEmpty={items.length === 0}
              onRetry={reload}
              emptyIcon={PackageSearch}
              emptyTitle="No products found"
              emptyDescription={
                hasFilters
                  ? "No product matches these filters. Try clearing them."
                  : "Create your first product to stock the storefront."
              }
            />
            {!loading &&
              !failed &&
              items.map((product) => (
                <TableRow key={product.id}>
                  <TableCell>
                    <img
                      src={product.image}
                      alt=""
                      className="size-9 rounded-md object-cover"
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{product.name}</p>
                      {product.archivedAt && (
                        <Badge variant="secondary">Archived</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {product.unit}
                    </p>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {product.categorySlug}
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="font-medium">
                      {formatPrice(product.price)}
                    </span>
                    {product.mrp > product.price && (
                      <span className="ml-1.5 text-xs text-muted-foreground line-through">
                        {formatPrice(product.mrp)}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="secondary"
                      className={
                        product.inStock
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400"
                          : "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400"
                      }
                    >
                      {product.inStock ? "In stock" : "Out of stock"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            disabled={pendingId === product.id}
                            aria-label={`Actions for ${product.name}`}
                          />
                        }
                      >
                        <MoreHorizontal className="size-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48">
                        <DropdownMenuItem
                          onClick={() => {
                            setEditing(product);
                            setFormOpen(true);
                          }}
                        >
                          <Pencil />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => toggleStock(product)}>
                          <PackageSearch />
                          {product.inStock
                            ? "Mark out of stock"
                            : "Mark in stock"}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => toggleArchived(product)}
                        >
                          {product.archivedAt ? <ArchiveRestore /> : <Archive />}
                          {product.archivedAt ? "Restore" : "Archive"}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => setDeleting(product)}>
                          <Trash2 />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
        <AdminPagination
          page={page}
          pageSize={ADMIN_PAGE_SIZE}
          total={total}
          onPageChange={setPage}
        />
      </Card>

      <ProductFormSheet
        open={formOpen}
        onOpenChange={setFormOpen}
        product={editing}
        categories={categories}
        onSaved={reload}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete ${deleting?.name ?? "product"}?`}
        description="If any past order contains this product it will be archived instead of deleted, so the order history stays intact."
        confirmLabel="Delete product"
        destructive
        pending={deletePending}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
