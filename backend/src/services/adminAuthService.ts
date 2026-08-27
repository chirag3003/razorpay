import { sign, verify } from "hono/jwt";
import { env } from "../config/env";
import { UnauthorizedError } from "../errors";

// Admin auth is deliberately its own primitive, kept apart from userService's human-session
// JWT: a different signing secret (ADMIN_JWT_SECRET) and a different claim shape ({ role },
// no `sub`). userService.verifyToken rejects anything without a string `sub`, and this
// verifier rejects anything without role === "admin", so the two token types are not
// interchangeable in either direction even though they share the Authorization: Bearer header.
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
