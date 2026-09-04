import { z } from "zod";
import { MAX_ORDER_PAGE_SIZE } from "../constants";

// GET /api/orders. Both fields are optional: the storefront sends neither and gets the default
// page, which is sized not to truncate any realistic order history.
export const listOrdersQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_ORDER_PAGE_SIZE)
    .optional()
    .default(MAX_ORDER_PAGE_SIZE),
  offset: z.coerce.number().int().nonnegative().optional().default(0),
});

export type ListOrdersQuery = z.infer<typeof listOrdersQuerySchema>;
