import { ilike, or, sql, type SQL } from "drizzle-orm";
import { products } from "../db/schema";

/**
 * The single definition of how a free-text product query is matched, isolated so the strategy can
 * be swapped (pg_trgm, full-text search, embeddings) without touching productService or any tool.
 *
 * Today: substring match on name OR any tag. Descriptions are excluded because every seeded
 * product shares one boilerplate description, so matching it returns the whole catalog. Semantic
 * matching is out of reach for ILIKE entirely — models are told in the tool description to fall
 * back to list_categories for vague requests.
 */
export function buildProductSearchCondition(q: string): SQL | undefined {
  const term = q.trim();
  if (!term) return undefined;

  const pattern = `%${term}%`;

  return or(
    ilike(products.name, pattern),
    // `tags` is text[]. ANY(...) with a LIKE pattern isn't expressible directly, hence unnest.
    sql`exists (select 1 from unnest(${products.tags}) as tag where tag ilike ${pattern})`
  );
}
