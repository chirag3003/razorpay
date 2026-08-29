import { ilike, or, sql, type SQL } from "drizzle-orm";
import { products } from "../db/schema";

/**
 * The single definition of how a free-text product query is matched.
 *
 * Isolated behind one function so the strategy can be replaced — pg_trgm for typo tolerance,
 * Postgres full-text search for stemming and ranking, or an embedding index for genuine semantic
 * matching — without touching productService or any agent tool.
 *
 * Today: substring match on the product name OR on any of its tags.
 *
 * Two deliberate exclusions:
 *
 * - **Descriptions.** Every seeded product shares one identical boilerplate description ("Farm-fresh
 *   X, handpicked for quality and freshness…"), so matching against it would return the entire
 *   catalog for any word in that template — worse than not searching it at all. Revisit when
 *   products carry real copy.
 * - **Semantic matching.** "something sweet" matches no name and no tag, and no amount of ILIKE
 *   fixes that. The agent-facing mitigation is in the tool description, not here: models are told
 *   to fall back to list_categories and filter by category for vague requests.
 *
 * Widening this from name-only to name-or-tag is purely additive — every product that matched
 * before still matches — so the storefront gains results ("organic" now finds the organic range)
 * without losing any.
 */
export function buildProductSearchCondition(q: string): SQL | undefined {
  const term = q.trim();
  if (!term) return undefined;

  const pattern = `%${term}%`;

  return or(
    ilike(products.name, pattern),
    // `tags` is text[]; unnest and match any element. ANY(...) with a LIKE pattern isn't
    // expressible directly, hence the subquery.
    sql`exists (select 1 from unnest(${products.tags}) as tag where tag ilike ${pattern})`
  );
}
