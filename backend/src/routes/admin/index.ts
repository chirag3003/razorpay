import { Hono } from "hono";
import type { AdminEnv } from "../../types";
import { adminAuthRoutes } from "./auth";
import { adminDashboardRoutes } from "./dashboard";
import { adminOrderRoutes } from "./orders";
import { adminProductRoutes } from "./products";
import { adminCategoryRoutes } from "./categories";
import { adminUserRoutes } from "./users";

// Mounted at /api/admin. Every sub-router except auth applies requireAdmin itself; /login is the
// one open route.
export const adminRoutes = new Hono<AdminEnv>();

adminRoutes.route("/", adminAuthRoutes);
adminRoutes.route("/dashboard", adminDashboardRoutes);
adminRoutes.route("/orders", adminOrderRoutes);
adminRoutes.route("/products", adminProductRoutes);
adminRoutes.route("/categories", adminCategoryRoutes);
adminRoutes.route("/users", adminUserRoutes);
