import { Hono } from "hono";
import type { AdminEnv } from "../../types";
import { adminAuthRoutes } from "./auth";
import { adminDashboardRoutes } from "./dashboard";
import { adminOrderRoutes } from "./orders";
import { adminProductRoutes } from "./products";
import { adminCategoryRoutes } from "./categories";
import { adminUserRoutes } from "./users";

// Mounted at /api/admin in server.ts. Every sub-router except auth applies requireAdmin
// itself (mirrors how orderRoutes/addressRoutes apply requireAuth); /login stays open.
export const adminRoutes = new Hono<AdminEnv>();

adminRoutes.route("/", adminAuthRoutes);
adminRoutes.route("/dashboard", adminDashboardRoutes);
adminRoutes.route("/orders", adminOrderRoutes);
adminRoutes.route("/products", adminProductRoutes);
adminRoutes.route("/categories", adminCategoryRoutes);
adminRoutes.route("/users", adminUserRoutes);
