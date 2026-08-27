// Shared URL-slug helper. Used by the seed script and by the admin product/category create
// endpoints so both derive slugs the same way.
export function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
