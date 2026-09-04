import { or, sql, type SQL } from "drizzle-orm";
import { products } from "../db/schema";

/**
 * The single definition of how a free-text product query is matched, isolated so the strategy can
 * be swapped (pg_trgm, full-text search, embeddings) without touching productService or any tool.
 *
 * Today: trigram-backed substring match on name OR exact tag overlap. Descriptions are excluded
 * because every seeded product shares one boilerplate description, so matching it returns the
 * whole catalog. Semantic matching is out of reach for ILIKE entirely — models are told in the
 * tool description to fall back to list_categories for vague requests.
 *
 * Both clauses are indexable, which the previous shape was not: `products_name_trgm_idx`
 * (gin, gin_trgm_ops) serves the leading-wildcard ILIKE, and `products_tags_gin_idx` (gin) serves
 * the array overlap. See the migration that adds them for why the old `EXISTS (SELECT 1 FROM
 * unnest(tags) …)` could not use an index.
 *
 * The trigram index makes this *fast*, not *fuzzy*: `ILIKE '%choclate%'` still matches nothing.
 * Typo tolerance needs the similarity operator (`%` / `similarity()`) and a threshold, which
 * would change what counts as a result — a separate decision, not a side effect of indexing.
 * The index is the prerequisite for it, and is in place if that is wanted later.
 */

/**
 * Escapes the LIKE metacharacters so a caller cannot inject wildcards — `%` matching everything
 * was harmless in practice but is not the caller's decision to make. The backslash goes first,
 * otherwise it would escape the escapes added after it. Paired with an explicit ESCAPE clause,
 * since the default only applies to a literal pattern.
 */
function escapeLikePattern(term: string) {
  return term.replace(/\\/g, "\\\\").replace(/[%_]/g, (ch) => `\\${ch}`);
}

export function buildProductSearchCondition(q: string): SQL | undefined {
  const term = q.trim();
  if (!term) return undefined;

  const pattern = `%${escapeLikePattern(term)}%`;

  return or(
    sql`${products.name} ilike ${pattern} escape '\\'`,
    // Overlap against a one-element array, so the plain GIN on `tags` applies. This is exact
    // element matching rather than the substring match the old unnest+ILIKE did: "organ" no
    // longer matches the tag `organic`. Deliberate — the tag clause is a bonus path and `name`
    // still matches substrings, which is where recall actually comes from.
    sql`${products.tags} && ARRAY[${term.toLowerCase()}]::text[]`
  );
}
