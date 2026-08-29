CREATE TABLE "cart_mandates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid NOT NULL,
	"cart_id" uuid NOT NULL,
	"mandate_id" uuid NOT NULL,
	"address_id" uuid NOT NULL,
	"delivery_slot" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"cart_fingerprint" text NOT NULL,
	"signature" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"order_id" uuid,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cart_mandates_status_check" CHECK ("status" in ('open', 'consumed', 'superseded', 'expired'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "cart_mandates_one_open_per_user" ON "cart_mandates" ("user_id") WHERE "status" = 'open';--> statement-breakpoint
ALTER TABLE "cart_mandates" ADD CONSTRAINT "cart_mandates_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "cart_mandates" ADD CONSTRAINT "cart_mandates_cart_id_carts_id_fkey" FOREIGN KEY ("cart_id") REFERENCES "carts"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "cart_mandates" ADD CONSTRAINT "cart_mandates_mandate_id_reserve_pay_mandates_id_fkey" FOREIGN KEY ("mandate_id") REFERENCES "reserve_pay_mandates"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "cart_mandates" ADD CONSTRAINT "cart_mandates_order_id_orders_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL;