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
import { defaultAddress } from "@/data/orders";

export function DeliveryLocation() {
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
          {defaultAddress.city} {defaultAddress.pincode}
          <ChevronDown className="size-3.5" />
        </span>
      </PopoverTrigger>
      <PopoverContent align="start">
        <PopoverHeader>
          <PopoverTitle>Delivery address</PopoverTitle>
          <PopoverDescription>
            {defaultAddress.line1}, {defaultAddress.city}, {defaultAddress.state}{" "}
            {defaultAddress.pincode}
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
