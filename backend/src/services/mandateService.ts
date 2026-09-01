import { createHmac } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import {
  cartMandates,
  type CartMandateSnapshot,
  type CartMandateLine,
} from "../db/schema";
import { env } from "../config/env";
import { CART_MANDATE_TTL_MINUTES } from "../constants";
import { ConflictError, NotFoundError } from "../errors";
import { pgErrorCode, PG_UNIQUE_VIOLATION } from "../utils/db-error";

// The Cart Mandate: a signed per-transaction record of what was agreed, separate from the
// Reserve Pay token's standing authority. That one says "up to ₹500 over 30 days"; this says
// "₹247 for exactly these six items, now".
//
// Two concrete jobs: a consumed quote records the order it produced, which makes place_order
// idempotent under an LLM retry; and the cart fingerprint makes a basket that moved after
// approval fail loudly instead of being charged at a total nobody agreed to.

type CartMandateRow = typeof cartMandates.$inferSelect;

/**
 * Derived from JWT_SECRET rather than its own env var. The fixed label keeps it cryptographically
 * separate, so a cart mandate signature can never be replayed as a session JWT or vice versa.
 */
function signingKey() {
  return createHmac("sha256", env.JWT_SECRET).update("cart-mandate-v1").digest();
}

/**
 * Canonical serialisation of what was agreed. Field order is fixed and explicit: signing
 * `JSON.stringify(row)` would change whenever a column is added or the driver reorders keys,
 * silently invalidating every quote in flight.
 */
function canonicalPayload(input: {
  userId: string;
  cartId: string;
  mandateId: string;
  addressId: string;
  deliverySlot: string;
  snapshot: CartMandateSnapshot;
  expiresAt: Date;
}) {
  return JSON.stringify({
    v: 1,
    userId: input.userId,
    cartId: input.cartId,
    mandateId: input.mandateId,
    addressId: input.addressId,
    deliverySlot: input.deliverySlot,
    total: input.snapshot.total,
    subtotal: input.snapshot.subtotal,
    deliveryFee: input.snapshot.deliveryFee,
    discount: input.snapshot.discount,
    lines: input.snapshot.lines.map((line) => [line.productId, line.qty, line.price]),
    expiresAt: input.expiresAt.toISOString(),
  });
}

function sign(payload: string) {
  return createHmac("sha256", signingKey()).update(payload).digest("hex");
}

/**
 * Fingerprint of product ids, quantities and prices. Sorted by product id so row reordering
 * doesn't read as a change; prices included so a catalog price move invalidates the quote too.
 */
export function fingerprintLines(lines: CartMandateLine[]) {
  const canonical = [...lines]
    .sort((a, b) => a.productId.localeCompare(b.productId))
    .map((line) => `${line.productId}:${line.qty}:${line.price}`)
    .join("|");

  return createHmac("sha256", signingKey()).update(canonical).digest("hex");
}

export function verifySignature(mandate: CartMandateRow) {
  const expected = sign(
    canonicalPayload({
      userId: mandate.userId,
      cartId: mandate.cartId,
      mandateId: mandate.mandateId,
      addressId: mandate.addressId,
      deliverySlot: mandate.deliverySlot,
      snapshot: mandate.snapshot,
      expiresAt: mandate.expiresAt,
    })
  );

  return expected === mandate.signature;
}

export function isExpired(mandate: CartMandateRow) {
  return mandate.expiresAt.getTime() <= Date.now();
}

/** Retires any open quote for this user. Called before issuing a new one. */
export async function supersedeOpenQuotes(userId: string) {
  await db
    .update(cartMandates)
    .set({ status: "superseded", updatedAt: new Date() })
    .where(and(eq(cartMandates.userId, userId), eq(cartMandates.status, "open")));
}

export async function createCartMandate(input: {
  userId: string;
  cartId: string;
  mandateId: string;
  addressId: string;
  deliverySlot: string;
  snapshot: CartMandateSnapshot;
}) {
  const expiresAt = new Date(Date.now() + CART_MANDATE_TTL_MINUTES * 60 * 1000);

  // One open quote per user — retire the previous rather than collide with the partial index.
  await supersedeOpenQuotes(input.userId);

  const signature = sign(canonicalPayload({ ...input, expiresAt }));

  try {
    const [created] = await db
      .insert(cartMandates)
      .values({
        userId: input.userId,
        cartId: input.cartId,
        mandateId: input.mandateId,
        addressId: input.addressId,
        deliverySlot: input.deliverySlot,
        snapshot: input.snapshot,
        cartFingerprint: fingerprintLines(input.snapshot.lines),
        signature,
        expiresAt,
      })
      .returning();

    if (!created) throw new Error("Failed to create cart mandate");
    return created;
  } catch (err) {
    // Two concurrent prepare_order calls; the index caught the loser.
    if (pgErrorCode(err) === PG_UNIQUE_VIOLATION) {
      throw new ConflictError(
        "Another order quote was created at the same time. Request a fresh one."
      );
    }
    throw err;
  }
}

export async function getCartMandate(userId: string, quoteId: string) {
  const [mandate] = await db
    .select()
    .from(cartMandates)
    .where(and(eq(cartMandates.id, quoteId), eq(cartMandates.userId, userId)))
    .limit(1);

  if (!mandate) throw new NotFoundError("Order quote");
  return mandate;
}

/**
 * The user's one open quote, or null. Unlike getCartMandate it does not throw on absence: both
 * callers are asking a question, not acting on an id. Expiry is not evaluated here — that
 * transition belongs to place_order.
 */
export async function getOpenCartMandate(userId: string) {
  const [mandate] = await db
    .select()
    .from(cartMandates)
    .where(and(eq(cartMandates.userId, userId), eq(cartMandates.status, "open")))
    .limit(1);

  return mandate ?? null;
}

export async function markStatus(
  quoteId: string,
  status: "superseded" | "expired" | "consumed",
  orderId?: string
) {
  await db
    .update(cartMandates)
    .set({ status, orderId: orderId ?? null, updatedAt: new Date() })
    .where(eq(cartMandates.id, quoteId));
}

/** Everything a caller needs to show the customer what they are about to buy. */
export function presentCartMandate(mandate: CartMandateRow) {
  return {
    quoteId: mandate.id,
    status: mandate.status,
    lines: mandate.snapshot.lines,
    totals: {
      subtotal: mandate.snapshot.subtotal,
      deliveryFee: mandate.snapshot.deliveryFee,
      discount: mandate.snapshot.discount,
      total: mandate.snapshot.total,
    },
    deliverySlot: mandate.deliverySlot,
    addressId: mandate.addressId,
    expiresAt: mandate.expiresAt,
    orderId: mandate.orderId,
  };
}
