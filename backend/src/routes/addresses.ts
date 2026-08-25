import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { addressSchema, updateAddressSchema } from "../schemas/address.schema";
import * as addressService from "../services/addressService";
import { requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types";

export const addressRoutes = new Hono<AppEnv>();

addressRoutes.use("*", requireAuth);

addressRoutes.get("/", async (c) => {
  const addresses = await addressService.listAddresses(c.get("userId"));
  return c.json({ addresses });
});

addressRoutes.post("/", zValidator("json", addressSchema), async (c) => {
  const address = await addressService.createAddress(c.get("userId"), c.req.valid("json"));
  return c.json({ address }, 201);
});

addressRoutes.patch("/:id", zValidator("json", updateAddressSchema), async (c) => {
  const address = await addressService.updateAddress(
    c.get("userId"),
    c.req.param("id"),
    c.req.valid("json")
  );
  return c.json({ address });
});

addressRoutes.delete("/:id", async (c) => {
  await addressService.deleteAddress(c.get("userId"), c.req.param("id"));
  return c.body(null, 204);
});
