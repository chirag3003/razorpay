import { z } from "zod";
import { ORDER_STATUSES } from "../constants";

// Filters for GET /api/admin/orders. Same conditions-array + pagination style as the
// storefront product query.
export const adminOrderQuerySchema = z.object({
  status: z.enum(ORDER_STATUSES).optional(),
  userId: z.uuid().optional(),
  // Inclusive bounds on placedAt; accept any ISO-8601 string.
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  // Substring match on orderNumber (case-insensitive).
  q: z.string().optional().default(""),
  sort: z
    .enum(["newest", "oldest", "total-desc", "total-asc"])
    .optional()
    .default("newest"),
  page: z.coerce.number().int().positive().optional().default(1),
  pageSize: z.coerce.number().int().positive().max(100).optional().default(20),
});

export type AdminOrderQuery = z.infer<typeof adminOrderQuerySchema>;

export const updateOrderStatusSchema = z.object({
  status: z.enum(ORDER_STATUSES),
});

export type UpdateOrderStatusInput = z.infer<typeof updateOrderStatusSchema>;
