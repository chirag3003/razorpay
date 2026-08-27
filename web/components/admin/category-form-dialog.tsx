"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { IconPicker } from "@/components/admin/icon-picker";
import { createCategory, updateCategory } from "@/lib/api/admin";
import { useAdminAuthStore, handleAdminApiError } from "@/store/admin-auth-store";
import { ApiError, ApiValidationError } from "@/lib/api/client";
import {
  adminCategorySchema,
  type AdminCategoryFormValues,
} from "@/lib/validation";
import { slugify } from "@/lib/utils";
import type { CategoryWithCount } from "@/lib/admin-types";

const EMPTY: AdminCategoryFormValues = {
  name: "",
  slug: "",
  description: "",
  icon: "ShoppingBasket",
  image: "",
};

export function CategoryFormDialog({
  open,
  onOpenChange,
  category,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Omit to create. */
  category?: CategoryWithCount;
  onSaved: () => void;
}) {
  const token = useAdminAuthStore((state) => state.token);
  const isEdit = Boolean(category);

  const form = useForm<AdminCategoryFormValues>({
    resolver: zodResolver(adminCategorySchema),
    defaultValues: EMPTY,
  });

  const { reset } = form;
  useEffect(() => {
    if (!open) return;
    reset(
      category
        ? {
            name: category.name,
            slug: category.slug,
            description: category.description,
            icon: category.icon,
            image: category.image,
          }
        : EMPTY
    );
  }, [open, category, reset]);

  async function onSubmit(values: AdminCategoryFormValues) {
    if (!token) return;
    const payload = {
      name: values.name,
      description: values.description,
      icon: values.icon,
      image: values.image,
      // Omitted on create so the backend derives it from the name.
      ...(values.slug?.trim() ? { slug: values.slug.trim() } : {}),
    };

    try {
      if (category) {
        await updateCategory(token, category.id, payload);
        toast.success("Category updated");
      } else {
        await createCategory(token, payload);
        toast.success("Category created");
      }
      onOpenChange(false);
      onSaved();
    } catch (err) {
      if (handleAdminApiError(err)) return;
      if (err instanceof ApiValidationError) {
        for (const fieldError of err.fieldErrors) {
          form.setError(fieldError.path as keyof AdminCategoryFormValues, {
            message: fieldError.message,
          });
        }
        return;
      }
      if (err instanceof ApiError && err.code === "CONFLICT") {
        form.setError("slug", {
          message: "That slug is already used by another category",
        });
        return;
      }
      form.setError("root", {
        message:
          err instanceof ApiError ? err.message : "Couldn't save the category",
      });
    }
  }

  const nameValue = form.watch("name");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Edit category" : "New category"}
          </DialogTitle>
          <DialogDescription>
            Categories group products on the storefront.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            id="category-form"
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-4"
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
                    <Input placeholder="Fruits & Vegetables" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="slug"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Slug</FormLabel>
                  <FormControl>
                    <Input
                      placeholder={slugify(nameValue || "") || "auto-generated"}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    {isEdit
                      ? "Changing this breaks existing links to the category."
                      : "Leave blank to generate it from the name."}
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
                    <Textarea rows={2} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="icon"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Icon</FormLabel>
                  <IconPicker value={field.value} onChange={field.onChange} />
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="image"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Image URL</FormLabel>
                  <FormControl>
                    <Input placeholder="https://…" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>

        <DialogFooter>
          <DialogClose
            render={
              <Button
                variant="outline"
                disabled={form.formState.isSubmitting}
              />
            }
          >
            Cancel
          </DialogClose>
          <Button
            type="submit"
            form="category-form"
            disabled={form.formState.isSubmitting}
          >
            {form.formState.isSubmitting && (
              <Loader2 className="size-4 animate-spin" />
            )}
            {isEdit ? "Save changes" : "Create category"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
