import { eq } from "drizzle-orm";
import { sign, verify } from "hono/jwt";
import { db } from "../db";
import { users } from "../db/schema";
import { ConflictError, NotFoundError, UnauthorizedError } from "../errors";
import { env } from "../config/env";
import type { SignupInput, UpdateProfileInput } from "../schemas/auth.schema";

const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

// Shorter-lived than the human session token: with no scope/spend-cap enforcement yet, a short
// TTL is the only containment available. refreshAccessToken renews it silently.
export const AGENT_TOKEN_TTL_SECONDS = 24 * 60 * 60; // 24 hours

export async function createUser(input: SignupInput) {
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, input.email))
    .limit(1);

  if (existing)
    throw new ConflictError("An account with this email already exists");

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

/**
 * A real argon2 hash to verify against when the email is unknown, so a miss costs the same as a
 * hit. Without it an unknown address answers in ~0ms while a known one pays for a full verify —
 * the response text is identical either way, but the timing enumerates accounts anyway.
 *
 * Computed once at module load, not per request: the point is to spend the same time as a real
 * verify, and hashing on every miss would spend considerably more.
 */
const DUMMY_PASSWORD_HASH = await Bun.password.hash("password-that-is-never-valid");

export async function verifyCredentials(email: string, password: string) {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  // Verify unconditionally — against the real hash if the account exists, against the dummy if it
  // does not — then decide. Both paths throw the same error, as they already did.
  const valid = await Bun.password.verify(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);

  if (!user || !valid) throw new UnauthorizedError("Invalid email or password");

  return user;
}

export async function getUserById(id: string) {
  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!user) throw new NotFoundError("User");
  return user;
}

export async function updateUser(userId: string, input: UpdateProfileInput) {
  if (input.email) {
    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, input.email))
      .limit(1);

    if (existing && existing.id !== userId) {
      throw new ConflictError("An account with this email already exists");
    }
  }

  const [user] = await db
    .update(users)
    .set(input)
    .where(eq(users.id, userId))
    .returning();

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
    if (typeof payload.sub !== "string")
      throw new UnauthorizedError("Invalid token");
    // Agent tokens carry actorType and must not double as a human session token — same secret,
    // deliberately distinct claim shape. verifyAgentToken is the mirror.
    if (payload.actorType !== undefined)
      throw new UnauthorizedError("Invalid token");
    return payload.sub;
  } catch {
    throw new UnauthorizedError("Invalid or expired token");
  }
}

/**
 * Issued only by oauthService's authorization-code/refresh-token exchange, never for a human to
 * copy-paste. Same secret as the session token — one trust boundary, one account being delegated
 * — tagged so the two are mutually exclusive.
 */
export function issueAgentToken(userId: string) {
  const exp = Math.floor(Date.now() / 1000) + AGENT_TOKEN_TTL_SECONDS;
  return sign({ sub: userId, actorType: "agent", exp }, env.JWT_SECRET, "HS256");
}

export async function verifyAgentToken(token: string) {
  try {
    const payload = await verify(token, env.JWT_SECRET, "HS256");
    if (typeof payload.sub !== "string" || payload.actorType !== "agent")
      throw new UnauthorizedError("Invalid agent token");
    return payload.sub;
  } catch {
    throw new UnauthorizedError("Invalid or expired agent token");
  }
}
