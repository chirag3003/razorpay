import {
  LayoutDashboard,
  Package,
  ShoppingBag,
  Tags,
  Users,
  type LucideIcon,
} from "lucide-react";
import type {
  AdminOrderSort,
  AdminProductSort,
  ArchivedFilter,
} from "@/lib/admin-types";
import type { OrderStatus } from "@/lib/types";

export const ADMIN_NAV: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/orders", label: "Orders", icon: ShoppingBag },
  { href: "/admin/products", label: "Products", icon: Package },
  { href: "/admin/categories", label: "Categories", icon: Tags },
  { href: "/admin/users", label: "Users", icon: Users },
];

export const ORDER_STATUSES: OrderStatus[] = [
  "placed",
  "shipped",
  "delivered",
  "cancelled",
];

export const ORDER_SORTS: { value: AdminOrderSort; label: string }[] = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "total-desc", label: "Total: high to low" },
  { value: "total-asc", label: "Total: low to high" },
];

export const PRODUCT_SORTS: { value: AdminProductSort; label: string }[] = [
  { value: "newest", label: "Newest first" },
  { value: "name-asc", label: "Name: A–Z" },
  { value: "price-asc", label: "Price: low to high" },
  { value: "price-desc", label: "Price: high to low" },
];

export const ARCHIVED_FILTERS: { value: ArchivedFilter; label: string }[] = [
  { value: "exclude", label: "Active only" },
  { value: "only", label: "Archived only" },
  { value: "all", label: "All products" },
];

/**
 * Curated Lucide names offered in the category icon picker. The backend accepts
 * any Lucide name as a free string, so the picker also allows typing one in.
 */
export const ADMIN_CATEGORY_ICONS = [
  "Apple", "Banana", "Beef", "Beer", "Cake", "Candy", "Carrot", "ChefHat",
  "Cherry", "Citrus", "Cookie", "Croissant", "CupSoda", "Drumstick", "Egg",
  "Fish", "Grape", "IceCream", "Leaf", "Martini", "Milk", "Nut", "Pizza",
  "Popcorn", "Salad", "Sandwich", "ShoppingBasket", "Soup", "Sparkles",
  "Sprout", "Wheat", "Wine", "Baby", "Bath", "Bone", "Brush", "Droplets",
  "Flower2", "Heart", "Home", "PawPrint", "Pill", "Shirt", "Snowflake",
  "Sun", "Utensils", "WashingMachine", "Wind",
];

/** Rows per page for the admin tables that support pagination. */
export const ADMIN_PAGE_SIZE = 20;
export const ADMIN_USERS_PAGE_SIZE = 50;
