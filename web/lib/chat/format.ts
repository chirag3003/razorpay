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

/**
 * Markdown source -> what it should sound like read aloud.
 *
 * The assistant's prose is rendered as markdown (see components/chat/markdown-message.tsx), but
 * the same string is also what gets synthesised. Sent raw, the emphasis the model wrote as
 * `**placed**` is read out as punctuation.
 *
 * A regex pass, not the remark AST: this needs to survive a partial stream and run inside the
 * chat store, and the input is one or two sentences of chat prose.
 */
export function toPlainText(markdown: string): string {
  return (
    markdown
      // Fenced code first, so its contents can't be mistaken for other syntax.
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/`([^`]+)`/g, "$1")
      // Images before links — the syntax differs only by the leading `!`, and alt text is not
      // worth speaking.
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      // Emphasis, longest markers first so `***x***` doesn't leave a stray asterisk behind.
      // Underscore runs additionally require a non-word character on each side, matching
      // CommonMark: without that, `get_cart` and `add_to_cart` — which the assistant does name
      // in prose — get read aloud as "getcart".
      // Written with a captured leading character rather than a lookbehind, which older iOS
      // Safari rejects at parse time (taking the whole module down with it).
      .replace(/\*\*\*(?=\S)([\s\S]*?\S)\*\*\*/g, "$1")
      .replace(/(^|[^A-Za-z0-9_])___(?=\S)([\s\S]*?\S)___(?![A-Za-z0-9])/g, "$1$2")
      .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, "$1")
      .replace(/(^|[^A-Za-z0-9_])__(?=\S)([\s\S]*?\S)__(?![A-Za-z0-9])/g, "$1$2")
      .replace(/\*(?=\S)([^*\n]*?\S)\*/g, "$1")
      .replace(/(^|[^A-Za-z0-9_])_(?=\S)([^_\n]*?\S)_(?![A-Za-z0-9])/g, "$1$2")
      .replace(/~~(?=\S)([\s\S]*?\S)~~/g, "$1")
      // Line-leading markers: headings, list bullets, blockquotes, horizontal rules.
      .replace(/^\s{0,3}#{1,6}\s+/gm, "")
      .replace(/^\s*([-*+]|\d+\.)\s+/gm, "")
      .replace(/^\s*>\s?/gm, "")
      .replace(/^\s*([-*_]\s*){3,}$/gm, "")
      .replace(/\s+/g, " ")
      .trim()
  );
}
