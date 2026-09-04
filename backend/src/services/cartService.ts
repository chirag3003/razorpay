import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { cartItems, carts, products } from "../db/schema";
import {
  EmptyCartError,
  NotFoundError,
  ProductUnavailableError,
  ValidationError,
} from "../errors";
import { getDeliveryFee, MAX_CART_ITEM_QTY } from "../constants";

// Cart is server-side, referenced by id (backend/CLAUDE.md "Cart Handling") — every function
// here takes a cart_id, never client- or agent-submitted contents. One active cart per user;
// getOrCreateActiveCartId is the only place that assumption lives.

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
    .select({ id: products.id, name: products.name, inStock: products.inStock })
    .from(products)
    .where(and(eq(products.id, productId), isNull(products.archivedAt)))
    .limit(1);

  if (!product) throw new NotFoundError("Product");

  // archivedAt hides a product that can never be sold again; inStock hides one that cannot be
  // sold right now. Checking only the first let the storefront add and check out an out-of-stock
  // product while the agent path correctly refused it.
  if (!product.inStock) {
    throw new ProductUnavailableError(`${product.name} is out of stock.`);
  }

  const [existing] = await db
    .select()
    .from(cartItems)
    .where(and(eq(cartItems.cartId, cartId), eq(cartItems.productId, productId)))
    .limit(1);

  // Against the resulting line, not the increment: qty is additive, so a schema bound on the
  // request alone lets repeated capped calls run a line past the cap and eventually past int4.
  // Here rather than only in the route schema or only in the agent tool, so every caller of the
  // service inherits it.
  const resultingQty = (existing?.qty ?? 0) + qty;
  if (resultingQty > MAX_CART_ITEM_QTY) {
    throw new ValidationError(
      `That would put ${product.name} at ${resultingQty}, over the limit of ${MAX_CART_ITEM_QTY} per item.`
    );
  }

  if (existing) {
    await db
      .update(cartItems)
      .set({ qty: resultingQty })
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
