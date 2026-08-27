import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import {
  loginSchema,
  signupSchema,
  updateProfileSchema,
} from "../schemas/auth.schema";
import * as userService from "../services/userService";
import { requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types";

export const authRoutes = new Hono<AppEnv>();

function toPublicUser(user: {
  id: string;
  name: string;
  email: string;
  phone: string;
  createdAt: Date;
}) {
  return { id: user.id, name: user.name, email: user.email, phone: user.phone };
}

authRoutes.post("/signup", zValidator("json", signupSchema), async (c) => {
  const input = c.req.valid("json");
  const user = await userService.createUser(input);
  const token = await userService.issueToken(user.id);
  return c.json({ user: toPublicUser(user), token }, 201);
});

authRoutes.post("/login", zValidator("json", loginSchema), async (c) => {
  const { email, password } = c.req.valid("json");
  const user = await userService.verifyCredentials(email, password);
  const token = await userService.issueToken(user.id);
  return c.json({ user: toPublicUser(user), token });
});

authRoutes.get("/me", requireAuth, async (c) => {
  const user = await userService.getUserById(c.get("userId"));
  return c.json({ user: toPublicUser(user) });
});

authRoutes.patch(
  "/me",
  requireAuth,
  zValidator("json", updateProfileSchema),
  async (c) => {
    const user = await userService.updateUser(
      c.get("userId"),
      c.req.valid("json"),
    );
    return c.json({ user: toPublicUser(user) });
  },
);
