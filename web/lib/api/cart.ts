import { apiFetch } from "@/lib/api/client";
import type { Cart } from "@/lib/types";

export function fetchCart(token: string): Promise<Cart> {
  return apiFetch<Cart>("/api/cart", { token });
}

export function addItem(
  token: string,
  productId: string,
  qty = 1
): Promise<Cart> {
  return apiFetch<Cart>("/api/cart/items", {
    method: "POST",
    token,
    body: { productId, qty },
  });
}

export function updateQty(
  token: string,
  itemId: string,
  qty: number
): Promise<Cart> {
  return apiFetch<Cart>(`/api/cart/items/${itemId}`, {
    method: "PATCH",
    token,
    body: { qty },
  });
}

export function removeItem(token: string, itemId: string): Promise<Cart> {
  return apiFetch<Cart>(`/api/cart/items/${itemId}`, {
    method: "DELETE",
    token,
  });
}

export function clearCart(token: string): Promise<Cart> {
  return apiFetch<Cart>("/api/cart", { method: "DELETE", token });
}
