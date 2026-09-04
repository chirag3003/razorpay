"use client";

import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCartStore } from "@/store/cart-store";
import { useAuthStore, handleAuthApiError } from "@/store/auth-store";
import type { OrderItem } from "@/lib/types";

export function ReorderButton({ items }: { items: OrderItem[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const token = useAuthStore((state) => state.token);
  const addItem = useCartStore((state) => state.addItem);

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        if (!token) {
          toast("Login to reorder these items");
          router.push(`/login?next=${encodeURIComponent(pathname)}`);
          return;
        }
        try {
          await Promise.all(
            items.map((item) => addItem(item.productId, item.qty))
          );
          toast.success("Items added to cart");
        } catch (err) {
          if (!handleAuthApiError(err)) {
            toast.error("Couldn't add items to cart");
          }
        }
      }}
    >
      <RotateCcw className="size-3.5" />
      Reorder
    </Button>
  );
}
