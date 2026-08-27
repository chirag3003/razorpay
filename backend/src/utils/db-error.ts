// Postgres SQLSTATE codes the services match on.
export const PG_UNIQUE_VIOLATION = "23505";
export const PG_FOREIGN_KEY_VIOLATION = "23503";

/**
 * Reads the Postgres SQLSTATE off a thrown query error.
 *
 * drizzle-orm v1 doesn't surface the driver error directly — it wraps it in a
 * `DrizzleQueryError` and hangs pg's `DatabaseError` (the object carrying `code`) off
 * `.cause`. Reading `err.code` therefore always yields `undefined`, silently turning
 * every "catch a constraint violation and handle it" branch into dead code. This walks
 * the cause chain instead, so it keeps working whether or not the driver error is
 * wrapped.
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
