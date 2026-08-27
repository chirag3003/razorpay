CREATE TABLE "reserve_pay_debits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"mandate_id" uuid NOT NULL,
	"order_id" uuid,
	"razorpay_order_id" text NOT NULL UNIQUE,
	"razorpay_payment_id" text,
	"amount_paise" integer NOT NULL,
	"status" text DEFAULT 'created' NOT NULL,
	"error_code" text,
	"error_description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "reserve_pay_debits_status_check" CHECK ("status" in ('created', 'captured', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "reserve_pay_mandates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid NOT NULL,
	"razorpay_customer_id" text NOT NULL,
	"razorpay_order_id" text NOT NULL UNIQUE,
	"razorpay_payment_id" text,
	"razorpay_token_id" text UNIQUE,
	"status" text DEFAULT 'pending' NOT NULL,
	"max_amount_paise" integer NOT NULL,
	"amount_blocked_paise" integer DEFAULT 0 NOT NULL,
	"amount_debited_paise" integer DEFAULT 0 NOT NULL,
	"vpa" text,
	"failure_reason" text,
	"intent_url" text,
	"expires_at" timestamp NOT NULL,
	"confirmed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "reserve_pay_mandates_status_check" CHECK ("status" in ('pending', 'confirmed', 'failed', 'revoked', 'expired', 'exhausted'))
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "razorpay_customer_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_razorpay_customer_id_key" UNIQUE("razorpay_customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reserve_pay_mandates_one_live_per_user" ON "reserve_pay_mandates" ("user_id") WHERE "status" in ('pending', 'confirmed');--> statement-breakpoint
ALTER TABLE "reserve_pay_debits" ADD CONSTRAINT "reserve_pay_debits_mandate_id_reserve_pay_mandates_id_fkey" FOREIGN KEY ("mandate_id") REFERENCES "reserve_pay_mandates"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "reserve_pay_debits" ADD CONSTRAINT "reserve_pay_debits_order_id_orders_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "reserve_pay_mandates" ADD CONSTRAINT "reserve_pay_mandates_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT;