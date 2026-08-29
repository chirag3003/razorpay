import { deliverySlotLabel, DELIVERY_SLOTS } from "../../constants";
import type { addresses, orders, products } from "../../db/schema";
import type { presentMandate } from "../../services/reservePayService";

/**
 * Projections from service/DB rows to the shapes tool callers see.
 *
 * Two jobs. First, token economy: a raw catalog row is ~180 tokens, ~62% of which is three
 * placeholder image URLs and a boilerplate description identical across all 58 products, so a
 * single default page of search results would cost ~2,200 tokens of near-zero information.
 * Second, containment: `getCartWithTotals` and `getOrderWithItems` nest the *entire* products
 * row, including `archivedAt` and a raw `categoryId` FK that nothing outside the DB should see.
 *
 * Shapes deliberately mirror web/lib/chat/protocol.ts (ChatProduct, ChatCartLine, ChatAddress,
 * ChatSlot, ChatMandate) so the AI layer can pass tool output almost straight into a message part
 * instead of re-mapping it.
 *
 * MONEY: everything here is integer rupees, matching protocol.ts and the rest of the app. The
 * Reserve Pay tables are the only place paise exist, so toAgentMandate is the one presenter that
 * converts.
 *
 * These live in the tool layer, not in /services — services stay caller-agnostic.
 */

type ProductRow = typeof products.$inferSelect;
type AddressRow = typeof addresses.$inferSelect;
type OrderRow = typeof orders.$inferSelect;

/** A catalog row from productService, which already drops archivedAt and joins categorySlug. */
type CatalogProduct = {
  id: string;
  slug: string;
  name: string;
  categorySlug: string;
  price: number;
  mrp: number;
  unit: string;
  image: string;
  inStock: boolean;
  tags: string[];
};

/** Mirrors ChatProduct. Drops images[], description, rating, ratingCount. */
export function toAgentProduct(product: CatalogProduct | ProductRow) {
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    unit: product.unit,
    price: product.price,
    mrp: product.mrp,
    image: product.image,
    inStock: product.inStock,
  };
}

/** The catalog shape plus the two fields that help a model filter and explain its picks. */
export function toAgentProductDetail(product: CatalogProduct) {
  return {
    ...toAgentProduct(product),
    category: product.categorySlug,
    tags: product.tags,
  };
}

/** Mirrors ChatCartLine. */
export function toAgentCartLine(item: {
  itemId: string;
  qty: number;
  product: ProductRow;
}) {
  return {
    itemId: item.itemId,
    productId: item.product.id,
    name: item.product.name,
    unit: item.product.unit,
    image: item.product.image,
    qty: item.qty,
    price: item.product.price,
  };
}

export function toAgentCart(cart: {
  cartId: string;
  items: Array<{ itemId: string; qty: number; product: ProductRow }>;
  itemCount: number;
  subtotal: number;
  deliveryFee: number;
  total: number;
}) {
  return {
    cartId: cart.cartId,
    lines: cart.items.map(toAgentCartLine),
    itemCount: cart.itemCount,
    subtotal: cart.subtotal,
    deliveryFee: cart.deliveryFee,
    total: cart.total,
  };
}

export function addressOneLine(address: AddressRow) {
  return [address.line1, address.line2, address.city, address.state, address.pincode]
    .filter(Boolean)
    .join(", ");
}

/** Mirrors ChatAddress — `label` is the address type ("Home"/"Work"/"Other"). */
export function toAgentAddress(address: AddressRow) {
  return {
    id: address.id,
    label: address.type,
    oneLine: addressOneLine(address),
    isDefault: address.isDefault,
  };
}

/** Mirrors ChatSlot. */
export function toAgentSlots() {
  return DELIVERY_SLOTS.map((slot) => ({
    id: slot.id,
    day: slot.day,
    time: slot.time,
    label: `${slot.day}, ${slot.time}`,
  }));
}

type PresentedMandate = ReturnType<typeof presentMandate>;

/**
 * Mirrors ChatMandate. Two conversions happen here and nowhere else:
 *
 * - paise → rupees, since these are the only paise-denominated values in the system.
 * - our seven-state mandate lifecycle collapses onto the frontend's three. That loses detail, so
 *   the richer status travels alongside in `get_payment_status`'s envelope rather than being
 *   thrown away: "paused" and "failed" both surface as "revoked" here because the only thing a
 *   shopper can do about either is set up a new block.
 */
export function toAgentMandate(mandate: PresentedMandate) {
  const status =
    mandate.status === "confirmed"
      ? "active"
      : mandate.status === "expired" || mandate.status === "exhausted"
        ? "expired"
        : "revoked";

  return {
    tokenId: mandate.id,
    status,
    detailedStatus: mandate.status,
    maxAmount: Math.round(mandate.maxAmountPaise / 100),
    amountBlocked: Math.round(mandate.amountBlockedPaise / 100),
    amountDebited: Math.round(mandate.amountDebitedPaise / 100),
    remaining: Math.round(mandate.remainingPaise / 100),
    expiredAt: mandate.expiresAt,
  };
}

/** Compact order — never the nested product rows getOrderWithItems returns. */
export function toAgentOrder(
  order: OrderRow & {
    items: Array<{ qty: number; priceAtPurchase: number; product: ProductRow }>;
  }
) {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    placedAt: order.placedAt,
    deliverySlot: order.deliverySlot,
    addressOneLine: [
      order.address.line1,
      order.address.line2,
      order.address.city,
      order.address.pincode,
    ]
      .filter(Boolean)
      .join(", "),
    subtotal: order.subtotal,
    deliveryFee: order.deliveryFee,
    discount: order.discount,
    total: order.total,
    itemCount: order.items.reduce((sum, item) => sum + item.qty, 0),
    items: order.items.map((item) => ({
      name: item.product.name,
      unit: item.product.unit,
      qty: item.qty,
      price: item.priceAtPurchase,
    })),
  };
}

/** Order list entries drop the line items entirely — a model asking "my orders" wants a list. */
export function toAgentOrderSummary(
  order: OrderRow & { items: Array<{ qty: number }> }
) {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    placedAt: order.placedAt,
    deliverySlot: order.deliverySlot,
    total: order.total,
    itemCount: order.items.reduce((sum, item) => sum + item.qty, 0),
  };
}

export { deliverySlotLabel };
