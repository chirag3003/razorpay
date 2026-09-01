import { z } from "zod";
import { RESERVE_PAY_MAX_AMOUNT, RESERVE_PAY_MAX_EXPIRY_DAYS } from "../constants";

// Both ceilings are regulatory, not preferences. Re-asserted inside reservePayService too,
// because chat and MCP callers reach it without passing through this validator.
export const createMandateSchema = z.object({
  amountInRupees: z
    .number()
    .int("Block amount must be a whole number of rupees")
    .positive()
    .max(RESERVE_PAY_MAX_AMOUNT, `Reserve Pay blocks are limited to ₹${RESERVE_PAY_MAX_AMOUNT}`),
  expiryDays: z
    .number()
    .int()
    .positive()
    .max(RESERVE_PAY_MAX_EXPIRY_DAYS, `Mandates can last at most ${RESERVE_PAY_MAX_EXPIRY_DAYS} days`)
    .optional(),
});

export type CreateMandateInput = z.infer<typeof createMandateSchema>;

export const debitMandateSchema = z.object({
  amountInRupees: z.number().int("Debit amount must be a whole number of rupees").positive(),
  description: z.string().max(255).optional(),
});

export type DebitMandateInput = z.infer<typeof debitMandateSchema>;
