"use client";

import { createElement, useState } from "react";
import * as Icons from "lucide-react";
import { ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ADMIN_CATEGORY_ICONS } from "@/lib/admin-constants";

export function resolveIcon(name: string): Icons.LucideIcon {
  return (
    (Icons[name as keyof typeof Icons] as Icons.LucideIcon | undefined) ??
    Icons.ShoppingBasket
  );
}

/**
 * Renders a Lucide icon looked up by name. A module-scope component so callers
 * don't bind a resolved icon in their own render body, which reads as creating
 * a component during render.
 */
export function LucideIconByName({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  return createElement(resolveIcon(name), { className });
}

/**
 * The backend accepts any Lucide name as a free string, so this offers a curated
 * shortlist rather than enumerating the whole library, and still lets a name be
 * typed in directly.
 */
export function IconPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const matches = ADMIN_CATEGORY_ICONS.filter((name) =>
    name.toLowerCase().includes(search.trim().toLowerCase())
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        nativeButton={false}
        render={
          <Button type="button" variant="outline" className="w-full justify-start" />
        }
      >
        <LucideIconByName name={value} className="size-4 text-primary" />
        <span className="flex-1 text-left">{value || "Pick an icon"}</span>
        <ChevronsUpDown className="size-4 opacity-50" />
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search or type a Lucide name…"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            {matches.length === 0 && (
              <CommandEmpty>
                {search.trim() ? (
                  <button
                    type="button"
                    className="text-sm font-medium text-primary hover:underline"
                    onClick={() => {
                      onChange(search.trim());
                      setOpen(false);
                    }}
                  >
                    Use &quot;{search.trim()}&quot;
                  </button>
                ) : (
                  "No icons found."
                )}
              </CommandEmpty>
            )}
            {matches.length > 0 && (
              <CommandGroup>
                {matches.map((name) => (
                  <CommandItem
                    key={name}
                    value={name}
                    onSelect={() => {
                      onChange(name);
                      setOpen(false);
                    }}
                  >
                    <LucideIconByName name={name} className="size-4 text-primary" />
                    {name}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
