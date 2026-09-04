/**
 * Splits rows carrying a `count(*) over()` window column into the page and its total.
 *
 * The alternative — running the filtered query twice, once for rows and once for `count(*)` —
 * repeats the same join and where clause on every listing, and the two halves can disagree if a
 * row is written between them. The window column costs one round trip and is computed over the
 * same snapshot as the rows.
 *
 * `total` is 0 on an empty page, because a window function over no rows produces no rows to read
 * it from.
 */
export function splitPagedRows<T extends Record<string, unknown>>(
  rows: (T & { totalCount: number })[]
): { items: Omit<T, "totalCount">[]; total: number } {
  return {
    items: rows.map(({ totalCount: _totalCount, ...rest }) => rest as Omit<T, "totalCount">),
    total: rows[0]?.totalCount ?? 0,
  };
}
