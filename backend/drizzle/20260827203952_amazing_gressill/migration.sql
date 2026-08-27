ALTER TABLE "reserve_pay_mandates" ALTER COLUMN "razorpay_order_id" DROP NOT NULL;--> statement-breakpoint
DROP INDEX "reserve_pay_mandates_one_live_per_user";--> statement-breakpoint
CREATE UNIQUE INDEX "reserve_pay_mandates_one_live_per_user" ON "reserve_pay_mandates" ("user_id") WHERE "status" in ('pending', 'confirmed', 'paused');--> statement-breakpoint
ALTER TABLE "reserve_pay_mandates" DROP CONSTRAINT "reserve_pay_mandates_status_check", ADD CONSTRAINT "reserve_pay_mandates_status_check" CHECK ("status" in ('pending', 'confirmed', 'paused', 'failed', 'revoked', 'expired', 'exhausted'));