"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Button } from "@/components/ui/button";
import type { Category } from "@/lib/types";

const TAG_OPTIONS = [
  { value: "organic", label: "Organic" },
  { value: "bestseller", label: "Bestseller" },
  { value: "new", label: "New arrivals" },
];

const PRICE_BUCKETS = [
  { value: "any", label: "Any price", min: undefined, max: undefined },
  { value: "under-100", label: "Under ₹100", min: undefined, max: 100 },
  { value: "100-300", label: "₹100 - ₹300", min: 100, max: 300 },
  { value: "over-300", label: "Over ₹300", min: 300, max: undefined },
] as const;

export function ProductFilters({ categories }: { categories: Category[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const selectedCategories = searchParams.getAll("category");
  const selectedTags = searchParams.getAll("tag");
  const inStockOnly = searchParams.get("inStock") === "1";
  const activeBucket =
    PRICE_BUCKETS.find(
      (bucket) =>
        String(bucket.min ?? "") === (searchParams.get("min") ?? "") &&
        String(bucket.max ?? "") === (searchParams.get("max") ?? "")
    )?.value ?? "any";

  function push(mutate: (params: URLSearchParams) => void) {
    const params = new URLSearchParams(searchParams.toString());
    mutate(params);
    params.delete("page");
    router.push(params.toString() ? `${pathname}?${params}` : pathname);
  }

  function toggleListValue(key: string, value: string) {
    push((params) => {
      const values = params.getAll(key).filter((v) => v !== value);
      if (!params.getAll(key).includes(value)) {
        values.push(value);
      }
      params.delete(key);
      values.forEach((v) => params.append(key, v));
    });
  }

  function setPriceBucket(value: string) {
    push((params) => {
      params.delete("min");
      params.delete("max");
      const bucket = PRICE_BUCKETS.find((b) => b.value === value);
      if (bucket?.min !== undefined) params.set("min", String(bucket.min));
      if (bucket?.max !== undefined) params.set("max", String(bucket.max));
    });
  }

  function toggleInStock(checked: boolean) {
    push((params) => {
      if (checked) params.set("inStock", "1");
      else params.delete("inStock");
    });
  }

  const hasActiveFilters =
    selectedCategories.length > 0 ||
    selectedTags.length > 0 ||
    inStockOnly ||
    activeBucket !== "any";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="font-heading font-medium">Filters</p>
        {hasActiveFilters && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => router.push(pathname)}
          >
            Clear all
          </Button>
        )}
      </div>

      <div className="space-y-3">
        <p className="text-sm font-medium">Category</p>
        <div className="space-y-2.5">
          {categories.map((category) => (
            <Label
              key={category.slug}
              className="flex items-center gap-2 font-normal"
            >
              <Checkbox
                checked={selectedCategories.includes(category.slug)}
                onCheckedChange={() =>
                  toggleListValue("category", category.slug)
                }
              />
              {category.name}
            </Label>
          ))}
        </div>
      </div>

      <Separator />

      <div className="space-y-3">
        <p className="text-sm font-medium">Price</p>
        <RadioGroup value={activeBucket} onValueChange={setPriceBucket}>
          {PRICE_BUCKETS.map((bucket) => (
            <Label
              key={bucket.value}
              className="flex items-center gap-2 font-normal"
            >
              <RadioGroupItem value={bucket.value} />
              {bucket.label}
            </Label>
          ))}
        </RadioGroup>
      </div>

      <Separator />

      <div className="space-y-3">
        <p className="text-sm font-medium">Tags</p>
        <div className="space-y-2.5">
          {TAG_OPTIONS.map((tag) => (
            <Label
              key={tag.value}
              className="flex items-center gap-2 font-normal"
            >
              <Checkbox
                checked={selectedTags.includes(tag.value)}
                onCheckedChange={() => toggleListValue("tag", tag.value)}
              />
              {tag.label}
            </Label>
          ))}
        </div>
      </div>

      <Separator />

      <div className="flex items-center justify-between">
        <Label htmlFor="in-stock-filter" className="text-sm font-medium">
          In stock only
        </Label>
        <Switch
          id="in-stock-filter"
          checked={inStockOnly}
          onCheckedChange={toggleInStock}
        />
      </div>
    </div>
  );
}
