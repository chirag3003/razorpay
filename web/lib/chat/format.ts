import type { Address } from "@/lib/types";
import type { ChatAddress, ChatMandate, Rupees } from "@/lib/chat/protocol";
import { DELIVERY_SLOTS } from "@/components/checkout/delivery-slot-picker";

/** "12 MG Road, Indiranagar · Bengaluru 560038" — one line, no name. */
export function addressOneLine(address: Address): string {
  const street = [address.line1, address.line2].filter(Boolean).join(", ");
  return `${street} · ${address.city} ${address.pincode}`;
}

export function toChatAddress(address: Address): ChatAddress {
  return {
    id: address.id,
    label: address.type,
    oneLine: addressOneLine(address),
    isDefault: address.isDefault,
  };
}

export function slotLabel(slotId: string): string {
  const slot = DELIVERY_SLOTS.find((option) => option.id === slotId);
  return slot ? `${slot.day}, ${slot.time}` : slotId;
}

export function remainingOf(mandate: ChatMandate | null): Rupees {
  if (!mandate) return 0;
  return Math.max(0, mandate.amountBlocked - mandate.amountDebited);
}

export function isMandateUsable(mandate: ChatMandate | null): mandate is ChatMandate {
  if (!mandate) return false;
  if (mandate.status !== "active") return false;
  return new Date(mandate.expiredAt).getTime() > Date.now();
}
