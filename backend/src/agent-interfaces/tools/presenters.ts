import { deliverySlotLabel, DELIVERY_SLOTS } from "../../constants";
import type { addresses, orders, products } from "../../db/schema";
import type { presentMandate } from "../../services/reservePayService";

/**
 * DB rows -> the shapes tool callers see. Two jobs: token economy (a raw catalog row is ~180
 * tokens, most of it placeholder image URLs and a description identical across all 58 products),
 * and containment (getCartWithTotals and getOrderWithItems nest the entire products row,
 * `archivedAt` and raw `categoryId` included).
 *
 * Shapes mirror web/lib/chat/protocol.ts so tool output can go almost straight into a message
 * part. Lives in the tool layer, not /services — services stay caller-agnostic.
 *
 * MONEY: integer rupees throughout. The Reserve Pay tables are the only paise, so toAgentMandate
 * is the one presenter that converts.
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
 * Mirrors ChatMandate. Two conversions happen only here: paise -> rupees, and the seven-state
 * mandate lifecycle collapsed onto the frontend's three. "paused" and "failed" both surface as
 * "revoked" because the shopper's only move for either is a new block; the richer status travels
 * alongside as `detailedStatus` rather than being lost.
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
    // Shown by the order-confirmation widget — the reference a customer quotes when something
    // goes wrong.
    paymentId: order.razorpayPaymentId,
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

/** Drops line items entirely — a model asking "my orders" wants a list, not a dashboard. */
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
