"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { ImageOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { createProduct, updateProduct } from "@/lib/api/admin";
import { useAdminAuthStore, handleAdminApiError } from "@/store/admin-auth-store";
import { ApiError, ApiValidationError } from "@/lib/api/client";
import {
  adminProductSchema,
  type AdminProductFormValues,
} from "@/lib/validation";
import type { AdminProduct, CategoryWithCount } from "@/lib/admin-types";

const EMPTY: AdminProductFormValues = {
  name: "",
  categorySlug: "",
  price: 0,
  mrp: 0,
  unit: "",
  image: "",
  description: "",
  images: "",
  tags: "",
  inStock: true,
};

function splitLines(value?: string) {
  return (value ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function splitTags(value?: string) {
  return (value ?? "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

/**
 * Handles both create and edit. Edit is a sheet rather than its own route
 * because the API has no `GET /api/admin/products/:id` — the list row already
 * holds the full record, so there's nothing to fetch.
 */
export function ProductFormSheet({
  open,
  onOpenChange,
  product,
  categories,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Omit to create. */
  product?: AdminProduct;
  categories: CategoryWithCount[];
  onSaved: () => void;
}) {
  const token = useAdminAuthStore((state) => state.token);
  const isEdit = Boolean(product);
  const [previewFailed, setPreviewFailed] = useState(false);

  const form = useForm<AdminProductFormValues>({
    resolver: zodResolver(adminProductSchema),
    defaultValues: EMPTY,
  });

  const { reset } = form;
  useEffect(() => {
    if (!open) return;
    setPreviewFailed(false);
    reset(
      product
        ? {
            name: product.name,
            categorySlug: product.categorySlug,
            price: product.price,
            mrp: product.mrp,
            unit: product.unit,
            image: product.image,
            description: product.description,
            images: product.images.join("\n"),
            tags: product.tags.join(", "),
            inStock: product.inStock,
          }
        : EMPTY
    );
  }, [open, product, reset]);

  const imageValue = form.watch("image");

  async function onSubmit(values: AdminProductFormValues) {
    if (!token) return;
    const images = splitLines(values.images);
    const payload = {
      name: values.name,
      categorySlug: values.categorySlug,
      price: values.price,
      mrp: values.mrp,
      unit: values.unit,
      image: values.image,
      description: values.description,
      inStock: values.inStock,
      tags: splitTags(values.tags),
      // Omitted so the backend defaults to [image].
      ...(images.length ? { images } : {}),
    };

    try {
      if (product) {
        await updateProduct(token, product.id, payload);
        toast.success("Product updated");
      } else {
        await createProduct(token, payload);
        toast.success("Product created");
      }
      onOpenChange(false);
      onSaved();
    } catch (err) {
      if (handleAdminApiError(err)) return;
      if (err instanceof ApiValidationError) {
        for (const fieldError of err.fieldErrors) {
          form.setError(fieldError.path as keyof AdminProductFormValues, {
            message: fieldError.message,
          });
        }
        return;
      }
      // A 404 here means the category slug didn't resolve — that belongs on the
      // field, not in the root slot.
      if (err instanceof ApiError && err.code === "NOT_FOUND") {
        form.setError("categorySlug", { message: "That category no longer exists" });
        return;
      }
      form.setError("root", {
        message:
          err instanceof ApiError ? err.message : "Couldn't save the product",
      });
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-lg">
        <SheetHeader className="border-b p-4">
          <SheetTitle>{isEdit ? "Edit product" : "New product"}</SheetTitle>
          <SheetDescription>
            {isEdit
              ? "Changes go live on the storefront immediately."
              : "The slug is generated from the name automatically."}
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="flex-1">
          <Form {...form}>
            <form
              id="product-form"
              onSubmit={form.handleSubmit(onSubmit)}
              className="space-y-4 p-4"
              noValidate
            >
              {form.formState.errors.root && (
                <p className="text-sm text-destructive">
                  {form.formState.errors.root.message}
                </p>
              )}

              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input placeholder="Cold Pressed Olive Oil" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Not a registered field — a read-only view of the server-derived
                  slug, so it uses plain primitives rather than the Form ones
                  (those require an enclosing FormField for their context). */}
              {isEdit && (
                <div className="grid gap-1.5">
                  <Label htmlFor="product-slug">Slug</Label>
                  <Input
                    id="product-slug"
                    value={product?.slug ?? ""}
                    readOnly
                    disabled
                  />
                  <p className="text-sm text-muted-foreground">
                    Generated from the original name and not editable.
                  </p>
                </div>
              )}

              <FormField
                control={form.control}
                name="categorySlug"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Category</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                    >
                      {/* FormControl clones onto exactly one element, so it wraps
                          the trigger — not Select, which is a context provider. */}
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Pick a category" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {categories.map((category) => (
                          <SelectItem key={category.id} value={category.slug}>
                            {category.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="price"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Price (₹)</FormLabel>
                      <FormControl>
                        <Input type="number" min={0} step={1} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="mrp"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>MRP (₹)</FormLabel>
                      <FormControl>
                        <Input type="number" min={0} step={1} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="unit"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Unit</FormLabel>
                    <FormControl>
                      <Input placeholder="500 ml" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="image"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Main image URL</FormLabel>
                    <FormControl>
                      <Input placeholder="https://…" {...field} />
                    </FormControl>
                    <FormDescription>
                      There is no file upload yet — paste a hosted image URL.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {imageValue && (
                <div className="flex items-center gap-3 rounded-lg border p-2">
                  {previewFailed ? (
                    <div className="flex size-14 items-center justify-center rounded-md bg-muted">
                      <ImageOff className="size-5 text-muted-foreground" />
                    </div>
                  ) : (
                    <img
                      src={imageValue}
                      alt=""
                      className="size-14 rounded-md object-cover"
                      onError={() => setPreviewFailed(true)}
                      onLoad={() => setPreviewFailed(false)}
                    />
                  )}
                  <p className="text-xs text-muted-foreground">
                    {previewFailed
                      ? "That URL didn't load — check it before saving."
                      : "Image preview"}
                  </p>
                </div>
              )}

              <FormField
                control={form.control}
                name="images"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Gallery URLs</FormLabel>
                    <FormControl>
                      <Textarea rows={3} placeholder="One URL per line" {...field} />
                    </FormControl>
                    <FormDescription>
                      Leave blank to use the main image only.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Textarea rows={3} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="tags"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tags</FormLabel>
                    <FormControl>
                      <Input placeholder="new, organic" {...field} />
                    </FormControl>
                    <FormDescription>
                      Comma separated. &quot;bestseller&quot; and &quot;new&quot;
                      drive the homepage rows.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Separator />

              <FormField
                control={form.control}
                name="inStock"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between gap-4">
                    <div className="space-y-0.5">
                      <FormLabel>In stock</FormLabel>
                      <FormDescription>
                        Out-of-stock products stay listed but can&apos;t be added
                        to a cart.
                      </FormDescription>
                    </div>
                    {/* Switch is checked/onCheckedChange — not a spreadable field. */}
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormItem>
                )}
              />
            </form>
          </Form>
        </ScrollArea>

        <SheetFooter className="flex-row justify-end gap-2 border-t p-4">
          <Button
            type="button"
            variant="outline"
            disabled={form.formState.isSubmitting}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            form="product-form"
            disabled={form.formState.isSubmitting}
          >
            {form.formState.isSubmitting && (
              <Loader2 className="size-4 animate-spin" />
            )}
            {isEdit ? "Save changes" : "Create product"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
