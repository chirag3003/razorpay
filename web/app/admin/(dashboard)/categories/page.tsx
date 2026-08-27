"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { MoreHorizontal, Pencil, Plus, Tags, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { AdminTableState } from "@/components/admin/admin-table-state";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { CategoryFormDialog } from "@/components/admin/category-form-dialog";
import { LucideIconByName } from "@/components/admin/icon-picker";
import { deleteCategory, getAdminCategories } from "@/lib/api/admin";
import { useAdminAuthStore, handleAdminApiError } from "@/store/admin-auth-store";
import { useAdminCategoriesStore } from "@/store/admin-categories-store";
import { ApiError } from "@/lib/api/client";
import type { CategoryWithCount } from "@/lib/admin-types";

export default function AdminCategoriesPage() {
  const token = useAdminAuthStore((state) => state.token);
  const invalidateCategories = useAdminCategoriesStore(
    (state) => state.invalidate
  );

  const [categories, setCategories] = useState<CategoryWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [query, setQuery] = useState("");

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CategoryWithCount | undefined>();
  const [deleting, setDeleting] = useState<CategoryWithCount | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function reload() {
    setLoading(true);
    setFailed(false);
    setReloadKey((key) => key + 1);
    // Keep the cached copy the products page reads in sync.
    invalidateCategories();
  }

  useEffect(() => {
    if (!token) return;
    let ignore = false;

    getAdminCategories(token)
      .then((data) => {
        if (!ignore) setCategories(data);
      })
      .catch((err) => {
        if (ignore) return;
        handleAdminApiError(err);
        setFailed(true);
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, [token, reloadKey]);

  // The endpoint is unpaginated and unfiltered, so search happens in memory.
  const term = query.trim().toLowerCase();
  const visible = term
    ? categories.filter(
        (category) =>
          category.name.toLowerCase().includes(term) ||
          category.slug.toLowerCase().includes(term)
      )
    : categories;

  async function confirmDelete() {
    if (!token || !deleting) return;
    setDeletePending(true);
    setDeleteError(null);
    try {
      await deleteCategory(token, deleting.id);
      toast.success("Category deleted");
      setDeleting(null);
      reload();
    } catch (err) {
      if (handleAdminApiError(err)) return;
      if (err instanceof ApiError && err.code === "CONFLICT") {
        setDeleteError(err.message);
        return;
      }
      setDeleteError(
        err instanceof ApiError ? err.message : "Couldn't delete the category"
      );
    } finally {
      setDeletePending(false);
    }
  }

  return (
    <div>
      <AdminPageHeader
        title="Categories"
        description={`${categories.length} ${categories.length === 1 ? "category" : "categories"}`}
      >
        <Button
          onClick={() => {
            setEditing(undefined);
            setFormOpen(true);
          }}
        >
          <Plus className="size-4" />
          New category
        </Button>
      </AdminPageHeader>

      <div className="mb-4">
        <AdminSearchInput
          value={query}
          onChange={setQuery}
          placeholder="Search categories…"
          className="sm:max-w-xs"
        />
      </div>

      <Card className="overflow-hidden p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12" />
              <TableHead>Name</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="text-right">Products</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            <AdminTableState
              colSpan={6}
              loading={loading}
              failed={failed}
              isEmpty={visible.length === 0}
              onRetry={reload}
              emptyIcon={Tags}
              emptyTitle="No categories found"
              emptyDescription={
                term
                  ? "No category matches that search."
                  : "Create a category to start grouping products."
              }
            />
            {!loading &&
              !failed &&
              visible.map((category) => {
                return (
                  <TableRow key={category.id}>
                    <TableCell>
                      <div className="flex size-9 items-center justify-center rounded-full bg-primary/10">
                        <LucideIconByName
                          name={category.icon}
                          className="size-4 text-primary"
                        />
                      </div>
                    </TableCell>
                    <TableCell className="font-medium">
                      {category.name}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {category.slug}
                    </TableCell>
                    <TableCell className="max-w-xs">
                      <p className="line-clamp-1 text-muted-foreground">
                        {category.description}
                      </p>
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant="secondary">{category.productCount}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Actions for ${category.name}`}
                            />
                          }
                        >
                          <MoreHorizontal className="size-4" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-40">
                          <DropdownMenuItem
                            onClick={() => {
                              setEditing(category);
                              setFormOpen(true);
                            }}
                          >
                            <Pencil />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => {
                              setDeleteError(null);
                              setDeleting(category);
                            }}
                          >
                            <Trash2 />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
          </TableBody>
        </Table>
      </Card>

      <CategoryFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        category={editing}
        onSaved={reload}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete ${deleting?.name ?? "category"}?`}
        description="Categories are hard-deleted — there's no archive. This can't be undone."
        confirmLabel="Delete category"
        destructive
        pending={deletePending}
        // The count is right here, so block the call rather than serve a 409.
        disabled={(deleting?.productCount ?? 0) > 0}
        onConfirm={confirmDelete}
      >
        {(deleting?.productCount ?? 0) > 0 && (
          <Alert variant="destructive">
            <AlertDescription>
              This category still has {deleting?.productCount} product
              {deleting?.productCount === 1 ? "" : "s"}. Reassign or delete them
              first.
            </AlertDescription>
          </Alert>
        )}
        {deleteError && (
          <Alert variant="destructive">
            <AlertDescription>{deleteError}</AlertDescription>
          </Alert>
        )}
      </ConfirmDialog>
    </div>
  );
}
