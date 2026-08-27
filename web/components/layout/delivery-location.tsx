"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { MapPin, ChevronDown } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  PopoverHeader,
  PopoverTitle,
  PopoverDescription,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/store/auth-store";
import { getAddresses } from "@/lib/api/addresses";
import type { Address } from "@/lib/types";

export function DeliveryLocation() {
  const token = useAuthStore((state) => state.token);
  const status = useAuthStore((state) => state.status);
  const [address, setAddress] = useState<Address | null>(null);

  useEffect(() => {
    if (!token || status !== "authenticated") {
      setAddress(null);
      return;
    }
    getAddresses(token)
      .then((addresses) => {
        setAddress(addresses.find((a) => a.isDefault) ?? addresses[0] ?? null);
      })
      .catch(() => setAddress(null));
  }, [token, status]);

  return (
    <Popover>
      <PopoverTrigger
        nativeButton={false}
        render={
          <Button
            variant="ghost"
            className="hidden h-auto flex-col items-start gap-0 px-2 py-1 text-left md:flex"
          />
        }
      >
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <MapPin className="size-3" />
          Deliver to
        </span>
        <span className="flex items-center gap-1 text-sm font-medium">
          {address ? `${address.city} ${address.pincode}` : "Select address"}
          <ChevronDown className="size-3.5" />
        </span>
      </PopoverTrigger>
      <PopoverContent align="start">
        <PopoverHeader>
          <PopoverTitle>Delivery address</PopoverTitle>
          <PopoverDescription>
            {address
              ? `${address.line1}, ${address.city}, ${address.state} ${address.pincode}`
              : "Add a delivery address from your account to see it here."}
          </PopoverDescription>
        </PopoverHeader>
        <Button
          size="sm"
          variant="outline"
          className="w-full"
          nativeButton={false}
          render={<Link href="/account" />}
        >
          Manage addresses
        </Button>
      </PopoverContent>
    </Popover>
  );
}
