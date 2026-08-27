export type Category = {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
  image: string;
};

export type Product = {
  id: string;
  slug: string;
  name: string;
  categorySlug: string;
  price: number;
  mrp: number;
  unit: string;
  image: string;
  images: string[];
  description: string;
  rating: number;
  ratingCount: number;
  inStock: boolean;
  tags: string[];
};

// The shape returned embedded inside a cart item or order item — the backend
// selects the raw product row here instead of the catalog-joined shape, so
// it carries categoryId (a raw FK) instead of categorySlug.
export type CartProduct = Omit<Product, "categorySlug"> & {
  categoryId: string;
};

export type CartLine = {
  itemId: string;
  qty: number;
  product: CartProduct;
};

export type Cart = {
  cartId: string;
  items: CartLine[];
  itemCount: number;
  subtotal: number;
  deliveryFee: number;
  total: number;
};

export type AddressType = "Home" | "Work" | "Other";

export type Address = {
  id: string;
  userId: string;
  type: AddressType;
  name: string;
  phone: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  pincode: string;
  isDefault: boolean;
};

// Frozen address snapshot embedded in an Order — not a live Address FK, so it
// has no id/userId/isDefault of its own.
export type OrderAddress = {
  type: string;
  name: string;
  phone: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  pincode: string;
};

export type OrderStatus =
  | "placed"
  | "confirmed"
  | "packed"
  | "out_for_delivery"
  | "delivered"
  | "cancelled";

export type OrderItem = {
  productId: string;
  qty: number;
  priceAtPurchase: number;
  product: CartProduct;
};

export type Order = {
  id: string;
  orderNumber: string;
  userId: string;
  placedAt: string;
  status: OrderStatus;
  items: OrderItem[];
  address: OrderAddress;
  deliverySlot: string;
  paymentMethod: string;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  subtotal: number;
  deliveryFee: number;
  discount: number;
  total: number;
};

export type User = {
  id: string;
  name: string;
  email: string;
  phone: string;
};

export type SortOption =
  | "popularity"
  | "price-asc"
  | "price-desc"
  | "rating"
  | "newest";
