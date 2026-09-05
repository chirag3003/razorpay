import { createHash, timingSafeEqual } from "node:crypto";
import { sign, verify } from "hono/jwt";
import { env } from "../config/env";
import { UnauthorizedError } from "../errors";

// Its own primitive, apart from userService's session JWT: different secret (ADMIN_JWT_SECRET),
// different claim shape ({ role }, no `sub`). verifyToken rejects a missing string `sub` and this
// rejects a missing role, so the two are not interchangeable in either direction.
const ADMIN_TOKEN_TTL_SECONDS = 12 * 60 * 60; // 12 hours

/**
 * Constant-time comparison of two arbitrary-length secrets. timingSafeEqual requires equal-length
 * buffers and throws otherwise, so comparing the sha256 digests rather than the raw strings keeps
 * the operands a fixed 32 bytes — which also means a wrong-length guess costs exactly as much as a
 * right-length one, so the password's length does not leak either.
 */
function secretsMatch(candidate: string, expected: string) {
  return timingSafeEqual(
    createHash("sha256").update(candidate, "utf8").digest(),
    createHash("sha256").update(expected, "utf8").digest()
  );
}

export async function login(password: string) {
  // One shared, unrotatable password guards the whole operator surface. There is no lockout and
  // no rate limit anywhere yet, so volume remains the attacker's easiest lever — but a
  // timing side channel costs nothing to remove.
  if (!secretsMatch(password, env.ADMIN_PASSWORD)) {
    throw new UnauthorizedError("Invalid admin password");
  }
  const exp = Math.floor(Date.now() / 1000) + ADMIN_TOKEN_TTL_SECONDS;
  return sign({ role: "admin", exp }, env.ADMIN_JWT_SECRET, "HS256");
}

export async function verifyAdminToken(token: string) {
  try {
    const payload = await verify(token, env.ADMIN_JWT_SECRET, "HS256");
    if (payload.role !== "admin") {
      throw new UnauthorizedError("Not an admin token");
    }
  } catch {
    throw new UnauthorizedError("Invalid or expired admin token");
  }
}
