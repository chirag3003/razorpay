"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { InputGroup, InputGroupAddon, InputGroupText } from "@/components/ui/input-group";
import { searchProducts } from "@/lib/api/catalog";
import { formatPrice } from "@/lib/utils";
import type { Product } from "@/lib/types";

export function SearchCommand() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Product[]>([]);
  const router = useRouter();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const timeout = setTimeout(() => {
      searchProducts(query, 8).then((products) => {
        if (!cancelled) setResults(products);
      });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [query]);

  function goToProduct(slug: string) {
    setOpen(false);
    setQuery("");
    router.push(`/products/${slug}`);
  }

  function goToSearchResults() {
    setOpen(false);
    router.push(`/products?q=${encodeURIComponent(query)}`);
    setQuery("");
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full"
        aria-label="Search products"
      >
        <InputGroup className="pointer-events-none h-9 rounded-full bg-muted">
          <InputGroupAddon>
            <Search className="size-4" />
          </InputGroupAddon>
          <InputGroupText className="text-muted-foreground">
            Search for atta, dal, oil, milk...
          </InputGroupText>
        </InputGroup>
      </button>

      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Search products"
        description="Search the grocery catalog"
      >
        <CommandInput
          placeholder="Search for products..."
          value={query}
          onValueChange={setQuery}
          onKeyDown={(event) => {
            if (event.key === "Enter" && query.trim()) {
              goToSearchResults();
            }
          }}
        />
        <CommandList>
          {query.trim() && results.length === 0 && (
            <CommandEmpty>No products found for &quot;{query}&quot;.</CommandEmpty>
          )}
          {results.length > 0 && (
            <CommandGroup heading="Products">
              {results.map((product) => (
                <CommandItem
                  key={product.id}
                  value={product.name}
                  onSelect={() => goToProduct(product.slug)}
                >
                  <img
                    src={product.image}
                    alt=""
                    className="size-8 shrink-0 rounded-md object-cover"
                  />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">{product.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {product.unit}
                    </span>
                  </div>
                  <span className="text-xs font-medium">
                    {formatPrice(product.price)}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </CommandDialog>
    </>
  );
}
