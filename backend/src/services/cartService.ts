import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { cartItems, carts, products } from "../db/schema";
import { EmptyCartError, NotFoundError } from "../errors";
import { getDeliveryFee } from "../constants";

// Cart is server-side, referenced by ID (backend/CLAUDE.md "Cart Handling") — every function
// below operates on a cart_id, never on client/agent-submitted cart contents. Each human user
// has exactly one active cart; getOrCreateActiveCartId is the only place that simplification
// lives, so a future agent caller that manages carts by id directly slots in without changes
// to addItem/updateItemQty/removeItem/getCartWithTotals.

export async function getOrCreateActiveCartId(userId: string) {
  const [existing] = await db
    .select({ id: carts.id })
    .from(carts)
    .where(eq(carts.userId, userId))
    .limit(1);

  if (existing) return existing.id;

  const [created] = await db.insert(carts).values({ userId }).returning({ id: carts.id });
  if (!created) throw new Error("Failed to create cart");
  return created.id;
}

async function assertItemBelongsToCart(cartId: string, itemId: string) {
  const [item] = await db
    .select()
    .from(cartItems)
    .where(and(eq(cartItems.id, itemId), eq(cartItems.cartId, cartId)))
    .limit(1);

  if (!item) throw new NotFoundError("Cart item");
  return item;
}

export async function addItem(cartId: string, productId: string, qty: number) {
  const [product] = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.id, productId), isNull(products.archivedAt)))
    .limit(1);

  if (!product) throw new NotFoundError("Product");

  const [existing] = await db
    .select()
    .from(cartItems)
    .where(and(eq(cartItems.cartId, cartId), eq(cartItems.productId, productId)))
    .limit(1);

  if (existing) {
    await db
      .update(cartItems)
      .set({ qty: existing.qty + qty })
      .where(eq(cartItems.id, existing.id));
  } else {
    await db.insert(cartItems).values({ cartId, productId, qty });
  }

  await db.update(carts).set({ updatedAt: new Date() }).where(eq(carts.id, cartId));
}

export async function updateItemQty(cartId: string, itemId: string, qty: number) {
  await assertItemBelongsToCart(cartId, itemId);

  if (qty <= 0) {
    await db.delete(cartItems).where(eq(cartItems.id, itemId));
  } else {
    await db.update(cartItems).set({ qty }).where(eq(cartItems.id, itemId));
  }

  await db.update(carts).set({ updatedAt: new Date() }).where(eq(carts.id, cartId));
}

export async function removeItem(cartId: string, itemId: string) {
  await assertItemBelongsToCart(cartId, itemId);
  await db.delete(cartItems).where(eq(cartItems.id, itemId));
  await db.update(carts).set({ updatedAt: new Date() }).where(eq(carts.id, cartId));
}

export async function clearCartItems(cartId: string) {
  await db.delete(cartItems).where(eq(cartItems.cartId, cartId));
}

export async function getCartWithTotals(cartId: string) {
  const rows = await db
    .select({
      itemId: cartItems.id,
      qty: cartItems.qty,
      product: products,
    })
    .from(cartItems)
    .innerJoin(products, eq(cartItems.productId, products.id))
    .where(eq(cartItems.cartId, cartId));

  const items = rows.map((row) => ({
    itemId: row.itemId,
    qty: row.qty,
    product: row.product,
  }));

  const subtotal = items.reduce((sum, item) => sum + item.product.price * item.qty, 0);
  const itemCount = items.reduce((sum, item) => sum + item.qty, 0);
  const deliveryFee = getDeliveryFee(subtotal);

  return {
    cartId,
    items,
    itemCount,
    subtotal,
    deliveryFee,
    total: subtotal + deliveryFee,
  };
}

export async function requireNonEmptyCart(cartId: string) {
  const cart = await getCartWithTotals(cartId);
  if (cart.items.length === 0) throw new EmptyCartError();
  return cart;
}
