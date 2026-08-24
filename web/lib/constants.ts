export const FREE_DELIVERY_THRESHOLD = 199;
export const DELIVERY_FEE = 25;

export function getDeliveryFee(subtotal: number) {
  if (subtotal === 0) return 0;
  return subtotal >= FREE_DELIVERY_THRESHOLD ? 0 : DELIVERY_FEE;
}
