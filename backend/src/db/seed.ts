// One-time seed script — ported from the same catalog data already built for the frontend
// (web/data/categories.ts, web/data/products.ts) so both apps show an identical catalog.
// Not a shared import: the two apps stay independent, this is just a copy at seed time.
import { db } from "./index";
import { categories, products } from "./schema";
import { slugify } from "../utils/slug";

const categoriesData = [
  {
    slug: "fruits-vegetables",
    name: "Fruits & Vegetables",
    description: "Fresh picks, straight from the farm",
    icon: "Carrot",
    image: "https://picsum.photos/seed/fruits-vegetables/600/400",
  },
  {
    slug: "dairy-eggs",
    name: "Dairy & Eggs",
    description: "Milk, cheese, curd, butter & more",
    icon: "Milk",
    image: "https://picsum.photos/seed/dairy-eggs/600/400",
  },
  {
    slug: "bakery",
    name: "Bakery",
    description: "Breads, buns, cakes & pastries",
    icon: "Croissant",
    image: "https://picsum.photos/seed/bakery/600/400",
  },
  {
    slug: "beverages",
    name: "Beverages",
    description: "Juices, soft drinks, tea & coffee",
    icon: "CupSoda",
    image: "https://picsum.photos/seed/beverages/600/400",
  },
  {
    slug: "snacks-munchies",
    name: "Snacks & Munchies",
    description: "Chips, namkeen, biscuits & more",
    icon: "Cookie",
    image: "https://picsum.photos/seed/snacks-munchies/600/400",
  },
  {
    slug: "staples-grains",
    name: "Staples & Grains",
    description: "Atta, rice, dal, oil & spices",
    icon: "Wheat",
    image: "https://picsum.photos/seed/staples-grains/600/400",
  },
  {
    slug: "personal-care",
    name: "Personal Care",
    description: "Skincare, haircare & hygiene",
    icon: "Sparkles",
    image: "https://picsum.photos/seed/personal-care/600/400",
  },
  {
    slug: "household-essentials",
    name: "Household Essentials",
    description: "Cleaning supplies & daily needs",
    icon: "SprayCan",
    image: "https://picsum.photos/seed/household-essentials/600/400",
  },
];

type RawProduct = {
  name: string;
  unit: string;
  price: number;
  mrp: number;
  rating: number;
  ratingCount: number;
  tags?: string[];
  inStock?: boolean;
  description?: string;
};

const productsByCategory: Record<string, RawProduct[]> = {
  "fruits-vegetables": [
    { name: "Fresh Bananas", unit: "6 pcs", price: 45, mrp: 55, rating: 4.4, ratingCount: 512, tags: ["bestseller"] },
    { name: "Royal Gala Apples", unit: "4 pcs", price: 149, mrp: 179, rating: 4.5, ratingCount: 340, tags: ["bestseller"] },
    { name: "Alphonso Mangoes", unit: "1 kg", price: 399, mrp: 450, rating: 4.7, ratingCount: 210, tags: ["seasonal"] },
    { name: "Organic Tomatoes", unit: "500 g", price: 35, mrp: 42, rating: 4.2, ratingCount: 180, tags: ["organic"] },
    { name: "Baby Spinach", unit: "200 g", price: 28, mrp: 32, rating: 4.1, ratingCount: 96, tags: ["organic"] },
    { name: "Red Onions", unit: "1 kg", price: 32, mrp: 38, rating: 4.0, ratingCount: 260 },
    { name: "Potatoes", unit: "1 kg", price: 29, mrp: 34, rating: 4.1, ratingCount: 300 },
    { name: "English Cucumber", unit: "500 g", price: 24, mrp: 28, rating: 4.0, ratingCount: 88 },
    { name: "Broccoli", unit: "250 g", price: 55, mrp: 65, rating: 4.3, ratingCount: 74, tags: ["new"] },
    { name: "Seedless Green Grapes", unit: "500 g", price: 89, mrp: 99, rating: 4.4, ratingCount: 150 },
  ],
  "dairy-eggs": [
    { name: "Toned Milk", unit: "1 L", price: 58, mrp: 62, rating: 4.5, ratingCount: 620, tags: ["bestseller"] },
    { name: "Farm Fresh Eggs", unit: "12 pcs", price: 89, mrp: 99, rating: 4.6, ratingCount: 410, tags: ["bestseller"] },
    { name: "Greek Yogurt", unit: "400 g", price: 129, mrp: 149, rating: 4.4, ratingCount: 185, tags: ["new"] },
    { name: "Salted Butter", unit: "200 g", price: 108, mrp: 120, rating: 4.5, ratingCount: 260 },
    { name: "Processed Cheese Slices", unit: "200 g", price: 115, mrp: 130, rating: 4.2, ratingCount: 175 },
    { name: "Fresh Curd", unit: "400 g", price: 42, mrp: 48, rating: 4.3, ratingCount: 290 },
    { name: "Paneer", unit: "200 g", price: 89, mrp: 99, rating: 4.5, ratingCount: 230, tags: ["bestseller"] },
    { name: "Whipping Cream", unit: "200 ml", price: 95, mrp: 110, rating: 4.1, ratingCount: 64 },
  ],
  bakery: [
    { name: "Whole Wheat Bread", unit: "400 g", price: 45, mrp: 50, rating: 4.3, ratingCount: 340, tags: ["bestseller"] },
    { name: "Multigrain Bread", unit: "400 g", price: 55, mrp: 62, rating: 4.4, ratingCount: 190, tags: ["organic"] },
    { name: "Burger Buns", unit: "6 pcs", price: 49, mrp: 55, rating: 4.1, ratingCount: 110 },
    { name: "Chocolate Croissant", unit: "4 pcs", price: 129, mrp: 145, rating: 4.6, ratingCount: 88, tags: ["new"] },
    { name: "Chocolate Muffins", unit: "4 pcs", price: 139, mrp: 155, rating: 4.5, ratingCount: 76 },
    { name: "Garlic Breadsticks", unit: "250 g", price: 69, mrp: 79, rating: 4.2, ratingCount: 54 },
  ],
  beverages: [
    { name: "Fresh Orange Juice", unit: "1 L", price: 110, mrp: 125, rating: 4.4, ratingCount: 210, tags: ["bestseller"] },
    { name: "Cola Soft Drink", unit: "750 ml", price: 40, mrp: 45, rating: 4.0, ratingCount: 380 },
    { name: "Assam Tea", unit: "250 g", price: 145, mrp: 165, rating: 4.6, ratingCount: 290, tags: ["bestseller"] },
    { name: "Instant Coffee", unit: "100 g", price: 210, mrp: 240, rating: 4.5, ratingCount: 260 },
    { name: "Packaged Drinking Water", unit: "1 L x 6", price: 90, mrp: 100, rating: 4.2, ratingCount: 150 },
    { name: "Mixed Fruit Nectar", unit: "1 L", price: 99, mrp: 115, rating: 4.1, ratingCount: 78, tags: ["new"] },
    { name: "Green Tea Bags", unit: "25 pcs", price: 175, mrp: 199, rating: 4.4, ratingCount: 132, tags: ["organic"] },
  ],
  "snacks-munchies": [
    { name: "Classic Salted Chips", unit: "150 g", price: 30, mrp: 35, rating: 4.2, ratingCount: 420, tags: ["bestseller"] },
    { name: "Masala Peanuts", unit: "200 g", price: 45, mrp: 52, rating: 4.3, ratingCount: 210 },
    { name: "Chocolate Cookies", unit: "300 g", price: 60, mrp: 70, rating: 4.5, ratingCount: 340, tags: ["bestseller"] },
    { name: "Cream Wafers", unit: "150 g", price: 35, mrp: 40, rating: 4.1, ratingCount: 96 },
    { name: "Roasted Makhana", unit: "100 g", price: 99, mrp: 115, rating: 4.4, ratingCount: 88, tags: ["organic", "new"] },
    { name: "Trail Mix", unit: "250 g", price: 189, mrp: 220, rating: 4.5, ratingCount: 140, tags: ["organic"] },
    { name: "Popcorn Butter", unit: "150 g", price: 55, mrp: 65, rating: 4.0, ratingCount: 72 },
  ],
  "staples-grains": [
    { name: "Whole Wheat Atta", unit: "5 kg", price: 249, mrp: 275, rating: 4.6, ratingCount: 520, tags: ["bestseller"] },
    { name: "Basmati Rice", unit: "5 kg", price: 549, mrp: 600, rating: 4.7, ratingCount: 380, tags: ["bestseller"] },
    { name: "Toor Dal", unit: "1 kg", price: 165, mrp: 185, rating: 4.4, ratingCount: 220 },
    { name: "Sunflower Cooking Oil", unit: "1 L", price: 145, mrp: 160, rating: 4.3, ratingCount: 260 },
    { name: "Turmeric Powder", unit: "200 g", price: 49, mrp: 56, rating: 4.5, ratingCount: 180, tags: ["organic"] },
    { name: "Red Chilli Powder", unit: "200 g", price: 55, mrp: 62, rating: 4.4, ratingCount: 160 },
    { name: "Chana Dal", unit: "1 kg", price: 115, mrp: 130, rating: 4.3, ratingCount: 140 },
    { name: "Rock Salt", unit: "1 kg", price: 35, mrp: 40, rating: 4.2, ratingCount: 90 },
  ],
  "personal-care": [
    { name: "Aloe Vera Face Wash", unit: "150 ml", price: 149, mrp: 170, rating: 4.3, ratingCount: 220 },
    { name: "Herbal Shampoo", unit: "340 ml", price: 199, mrp: 230, rating: 4.4, ratingCount: 260, tags: ["bestseller"] },
    { name: "Charcoal Soap", unit: "3 x 100 g", price: 129, mrp: 150, rating: 4.2, ratingCount: 140 },
    { name: "Toothpaste", unit: "150 g", price: 89, mrp: 99, rating: 4.5, ratingCount: 310, tags: ["bestseller"] },
    { name: "Moisturising Lotion", unit: "200 ml", price: 175, mrp: 199, rating: 4.3, ratingCount: 130, tags: ["new"] },
    { name: "Sunscreen SPF 50", unit: "100 ml", price: 299, mrp: 340, rating: 4.6, ratingCount: 96 },
  ],
  "household-essentials": [
    { name: "Dish Wash Liquid", unit: "500 ml", price: 99, mrp: 115, rating: 4.3, ratingCount: 280, tags: ["bestseller"] },
    { name: "Floor Cleaner", unit: "1 L", price: 129, mrp: 145, rating: 4.2, ratingCount: 190 },
    { name: "Laundry Detergent", unit: "1 kg", price: 159, mrp: 180, rating: 4.4, ratingCount: 240, tags: ["bestseller"] },
    { name: "Toilet Cleaner", unit: "500 ml", price: 89, mrp: 100, rating: 4.1, ratingCount: 110 },
    { name: "Garbage Bags", unit: "30 pcs", price: 99, mrp: 115, rating: 4.0, ratingCount: 150 },
    { name: "Paper Towels", unit: "2 rolls", price: 79, mrp: 90, rating: 4.3, ratingCount: 88, tags: ["new"] },
  ],
};

async function seed() {
  await db.insert(categories).values(categoriesData).onConflictDoNothing({ target: categories.slug });

  const insertedCategories = await db.select().from(categories);
  const categoryIdBySlug = new Map(insertedCategories.map((c) => [c.slug, c.id]));

  let productCount = 0;

  for (const [categorySlug, items] of Object.entries(productsByCategory)) {
    const categoryId = categoryIdBySlug.get(categorySlug);
    if (!categoryId) {
      console.warn(`Skipping products for unknown category slug: ${categorySlug}`);
      continue;
    }

    const rows = items.map((item) => {
      const slug = slugify(item.name);
      return {
        slug,
        name: item.name,
        categoryId,
        price: item.price,
        mrp: item.mrp,
        unit: item.unit,
        image: `https://picsum.photos/seed/${slug}/600/600`,
        images: [
          `https://picsum.photos/seed/${slug}/600/600`,
          `https://picsum.photos/seed/${slug}-2/600/600`,
          `https://picsum.photos/seed/${slug}-3/600/600`,
        ],
        description:
          item.description ??
          `Farm-fresh ${item.name.toLowerCase()}, handpicked for quality and freshness. Delivered straight to your door in eco-friendly packaging.`,
        rating: item.rating,
        ratingCount: item.ratingCount,
        inStock: item.inStock ?? true,
        tags: item.tags ?? [],
      };
    });

    await db.insert(products).values(rows).onConflictDoNothing({ target: products.slug });
    productCount += rows.length;
  }

  console.log(
    `Seeded ${insertedCategories.length} categories and up to ${productCount} products (existing rows skipped on conflict).`
  );
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
