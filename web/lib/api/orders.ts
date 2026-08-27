import { apiFetch } from "@/lib/api/client";
import type { Order } from "@/lib/types";

export async function getOrders(token: string): Promise<Order[]> {
  const { orders } = await apiFetch<{ orders: Order[] }>("/api/orders", {
    token,
  });
  return orders;
}

export async function getOrderById(
  token: string,
  id: string
): Promise<Order> {
  const { order } = await apiFetch<{ order: Order }>(`/api/orders/${id}`, {
    token,
  });
  return order;
}
