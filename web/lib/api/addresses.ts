import { apiFetch } from "@/lib/api/client";
import type { Address } from "@/lib/types";
import type { AddressFormValues } from "@/lib/validation";

export async function getAddresses(token: string): Promise<Address[]> {
  const { addresses } = await apiFetch<{ addresses: Address[] }>(
    "/api/addresses",
    { token }
  );
  return addresses;
}

export async function createAddress(
  token: string,
  data: AddressFormValues
): Promise<Address> {
  const { address } = await apiFetch<{ address: Address }>("/api/addresses", {
    method: "POST",
    token,
    body: { ...data, line2: data.line2 || undefined },
  });
  return address;
}

export async function updateAddress(
  token: string,
  id: string,
  data: Partial<AddressFormValues>
): Promise<Address> {
  const { address } = await apiFetch<{ address: Address }>(
    `/api/addresses/${id}`,
    {
      method: "PATCH",
      token,
      body: { ...data, line2: data.line2 || undefined },
    }
  );
  return address;
}

export function deleteAddress(token: string, id: string): Promise<void> {
  return apiFetch<void>(`/api/addresses/${id}`, { method: "DELETE", token });
}
