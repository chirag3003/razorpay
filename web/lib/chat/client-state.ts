/**
 * Snapshot of what the client knows, attached to every request.
 *
 * This is how the agent stays current without cart mutations being routed
 * through it: the cart is rebuilt from the store on every send, so the agent is
 * never more than one turn stale.
 */

import { useCartStore } from "@/store/cart-store";
import type { Address } from "@/lib/types";
import type { ChatCartLine, ClientState, WidgetAction } from "@/lib/chat/protocol";

export function buildClientState(input: {
  route: string;
  addresses: Address[];
  recentActions: WidgetAction[];
}): ClientState {
  const cart = useCartStore.getState().cart;

  const lines: ChatCartLine[] =
    cart?.items.map((line) => ({
      itemId: line.itemId,
      productId: line.product.id,
      name: line.product.name,
      unit: line.product.unit,
      image: line.product.image,
      qty: line.qty,
      price: line.product.price,
    })) ?? [];

  const defaultAddress =
    input.addresses.find((address) => address.isDefault) ?? input.addresses[0];

  return {
    route: input.route,
    cart: {
      cartId: cart?.cartId ?? null,
      itemCount: cart?.itemCount ?? 0,
      subtotal: cart?.subtotal ?? 0,
      deliveryFee: cart?.deliveryFee ?? 0,
      total: cart?.total ?? 0,
      lines,
    },
    addressCount: input.addresses.length,
    defaultAddressId: defaultAddress?.id ?? null,
    // The server rebuilds mandate truth from the DB every turn and never reads
    // this field — nothing to send.
    mandate: null,
    recentActions: input.recentActions,
  };
}
