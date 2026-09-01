// Postgres SQLSTATE codes the services match on.
export const PG_UNIQUE_VIOLATION = "23505";
export const PG_FOREIGN_KEY_VIOLATION = "23503";

/**
 * Reads the Postgres SQLSTATE off a thrown query error.
 *
 * drizzle-orm v1 wraps driver errors in a `DrizzleQueryError` and hangs pg's `DatabaseError`
 * (which carries `code`) off `.cause`, so `err.code` is always undefined and every
 * catch-a-constraint-violation branch silently becomes dead code. This walks the cause chain.
 */
export function pgErrorCode(err: unknown): string | undefined {
  let current: unknown = err;

  // Bounded so a self-referential cause chain can't spin.
  for (let depth = 0; current !== null && current !== undefined && depth < 5; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") return code;
    current = (current as { cause?: unknown }).cause;
  }

  return undefined;
}
