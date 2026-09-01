import { sign, verify } from "hono/jwt";
import { env } from "../config/env";
import { UnauthorizedError } from "../errors";

// Its own primitive, apart from userService's session JWT: different secret (ADMIN_JWT_SECRET),
// different claim shape ({ role }, no `sub`). verifyToken rejects a missing string `sub` and this
// rejects a missing role, so the two are not interchangeable in either direction.
const ADMIN_TOKEN_TTL_SECONDS = 12 * 60 * 60; // 12 hours

export async function login(password: string) {
  if (password !== env.ADMIN_PASSWORD) {
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
