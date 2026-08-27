// Mirrors the backend's free-delivery threshold (see backend/API.md §4) — used
// only for the "add X more for free delivery" hint text; the actual delivery
// fee always comes from the backend's cart/order response.
export const FREE_DELIVERY_THRESHOLD = 199;
