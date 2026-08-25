import { eq } from "drizzle-orm";
import { sign, verify } from "hono/jwt";
import { db } from "../db";
import { users } from "../db/schema";
import { ConflictError, NotFoundError, UnauthorizedError } from "../errors";
import { env } from "../config/env";
import type { SignupInput } from "../schemas/auth.schema";

const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

export async function createUser(input: SignupInput) {
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, input.email))
    .limit(1);

  if (existing) throw new ConflictError("An account with this email already exists");

  const passwordHash = await Bun.password.hash(input.password);

  const [user] = await db
    .insert(users)
    .values({
      name: input.name,
      email: input.email,
      phone: input.phone,
      passwordHash,
    })
    .returning();

  if (!user) throw new Error("Failed to create user");
  return user;
}

export async function verifyCredentials(email: string, password: string) {
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

  if (!user) throw new UnauthorizedError("Invalid email or password");

  const valid = await Bun.password.verify(password, user.passwordHash);
  if (!valid) throw new UnauthorizedError("Invalid email or password");

  return user;
}

export async function getUserById(id: string) {
  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!user) throw new NotFoundError("User");
  return user;
}

export function issueToken(userId: string) {
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  return sign({ sub: userId, exp }, env.JWT_SECRET, "HS256");
}

export async function verifyToken(token: string) {
  try {
    const payload = await verify(token, env.JWT_SECRET, "HS256");
    if (typeof payload.sub !== "string") throw new UnauthorizedError("Invalid token");
    return payload.sub;
  } catch {
    throw new UnauthorizedError("Invalid or expired token");
  }
}
