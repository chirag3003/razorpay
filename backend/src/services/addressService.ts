import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { addresses } from "../db/schema";
import { InvalidAddressError } from "../errors";
import type { AddressInput, UpdateAddressInput } from "../schemas/address.schema";

export async function listAddresses(userId: string) {
  return db.select().from(addresses).where(eq(addresses.userId, userId));
}

export async function createAddress(userId: string, input: AddressInput) {
  const [address] = await db
    .insert(addresses)
    .values({ ...input, userId })
    .returning();

  if (!address) throw new Error("Failed to create address");
  return address;
}

async function assertOwnership(userId: string, addressId: string) {
  const [address] = await db
    .select()
    .from(addresses)
    .where(and(eq(addresses.id, addressId), eq(addresses.userId, userId)))
    .limit(1);

  if (!address) throw new InvalidAddressError();
  return address;
}

export async function updateAddress(
  userId: string,
  addressId: string,
  input: UpdateAddressInput
) {
  await assertOwnership(userId, addressId);

  const [updated] = await db
    .update(addresses)
    .set(input)
    .where(eq(addresses.id, addressId))
    .returning();

  if (!updated) throw new Error("Failed to update address");
  return updated;
}

export async function deleteAddress(userId: string, addressId: string) {
  await assertOwnership(userId, addressId);
  await db.delete(addresses).where(eq(addresses.id, addressId));
}

export async function getAddressForUser(userId: string, addressId: string) {
  return assertOwnership(userId, addressId);
}
