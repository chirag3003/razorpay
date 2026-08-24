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

export type CartItem = {
  productId: string;
  qty: number;
};

export type AddressType = "Home" | "Work" | "Other";

export type Address = {
  id: string;
  type: AddressType;
  name: string;
  phone: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  pincode: string;
  isDefault?: boolean;
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
};

export type Order = {
  id: string;
  orderNumber: string;
  placedAt: string;
  status: OrderStatus;
  items: OrderItem[];
  address: Address;
  deliverySlot: string;
  paymentMethod: string;
  subtotal: number;
  deliveryFee: number;
  discount: number;
  total: number;
};

export type SortOption =
  | "popularity"
  | "price-asc"
  | "price-desc"
  | "rating"
  | "newest";
