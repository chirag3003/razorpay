import { z } from "zod";

// Read-only user listing for the admin dashboard.
export const adminUserQuerySchema = z.object({
  // Substring match on name or email (case-insensitive).
  q: z.string().optional().default(""),
  page: z.coerce.number().int().positive().optional().default(1),
  pageSize: z.coerce.number().int().positive().max(100).optional().default(50),
});

export type AdminUserQuery = z.infer<typeof adminUserQuerySchema>;
