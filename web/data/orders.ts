import type { Address, Order } from "@/lib/types";

export const defaultAddress: Address = {
  id: "addr-1",
  type: "Home",
  name: "Aarav Sharma",
  phone: "+91 98765 43210",
  line1: "402, Sunrise Apartments, MG Road",
  line2: "Near Metro Station",
  city: "Bengaluru",
  state: "Karnataka",
  pincode: "560001",
  isDefault: true,
};

export const workAddress: Address = {
  id: "addr-2",
  type: "Work",
  name: "Aarav Sharma",
  phone: "+91 98765 43210",
  line1: "5th Floor, Tech Park One",
  line2: "Whitefield",
  city: "Bengaluru",
  state: "Karnataka",
  pincode: "560066",
};

export const addresses: Address[] = [defaultAddress, workAddress];

export const orders: Order[] = [
  {
    id: "ord-1004",
    orderNumber: "FC-100425",
    placedAt: "2026-08-25T09:15:00+05:30",
    status: "placed",
    items: [
      { productId: "snacks-munchies-1", qty: 3, priceAtPurchase: 30 },
      { productId: "beverages-3", qty: 1, priceAtPurchase: 145 },
    ],
    address: defaultAddress,
    deliverySlot: "Today, 6:00 PM - 8:00 PM",
    paymentMethod: "UPI",
    subtotal: 235,
    deliveryFee: 0,
    discount: 0,
    total: 235,
  },
  {
    id: "ord-1003",
    orderNumber: "FC-100324",
    placedAt: "2026-08-24T14:30:00+05:30",
    status: "out_for_delivery",
    items: [
      { productId: "staples-grains-1", qty: 1, priceAtPurchase: 249 },
      { productId: "staples-grains-4", qty: 1, priceAtPurchase: 145 },
    ],
    address: defaultAddress,
    deliverySlot: "Today, 4:00 PM - 6:00 PM",
    paymentMethod: "Card",
    subtotal: 394,
    deliveryFee: 0,
    discount: 0,
    total: 394,
  },
  {
    id: "ord-1002",
    orderNumber: "FC-100218",
    placedAt: "2026-08-18T11:00:00+05:30",
    status: "delivered",
    items: [
      { productId: "fruits-vegetables-1", qty: 2, priceAtPurchase: 45 },
      { productId: "dairy-eggs-2", qty: 1, priceAtPurchase: 89 },
      { productId: "bakery-1", qty: 1, priceAtPurchase: 45 },
    ],
    address: defaultAddress,
    deliverySlot: "18 Aug, 10:00 AM - 12:00 PM",
    paymentMethod: "UPI",
    subtotal: 224,
    deliveryFee: 0,
    discount: 10,
    total: 214,
  },
  {
    id: "ord-1001",
    orderNumber: "FC-100110",
    placedAt: "2026-08-10T18:45:00+05:30",
    status: "cancelled",
    items: [
      { productId: "personal-care-2", qty: 1, priceAtPurchase: 199 },
      { productId: "household-essentials-1", qty: 1, priceAtPurchase: 99 },
    ],
    address: workAddress,
    deliverySlot: "10 Aug, 6:00 PM - 8:00 PM",
    paymentMethod: "Cash on Delivery",
    subtotal: 298,
    deliveryFee: 0,
    discount: 0,
    total: 298,
  },
];
