ALTER TABLE "products" ADD COLUMN "created_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "reserve_pay_mandates" ADD COLUMN "synced_at" timestamp;--> statement-breakpoint
CREATE INDEX "addresses_user_idx" ON "addresses" ("user_id");--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "audit_log" ("actor_type","actor_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_log_action_idx" ON "audit_log" ("action","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "cart_mandates_user_idx" ON "cart_mandates" ("user_id");--> statement-breakpoint
CREATE INDEX "oauth_refresh_tokens_user_client_idx" ON "oauth_refresh_tokens" ("user_id","client_id");--> statement-breakpoint
CREATE INDEX "order_items_order_idx" ON "order_items" ("order_id");--> statement-breakpoint
CREATE INDEX "orders_user_placed_idx" ON "orders" ("user_id","placed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "products_category_idx" ON "products" ("category_id");--> statement-breakpoint
CREATE INDEX "reserve_pay_debits_mandate_idx" ON "reserve_pay_debits" ("mandate_id");--> statement-breakpoint
-- Hand-written below this line: drizzle-kit cannot express an extension or an operator-class
-- index, and `generate` diffs the TS schema against its own snapshot rather than the live
-- database, so these are not reverted by a later generate.

-- Product search was a leading-wildcard ILIKE on name OR'd with an EXISTS over unnest(tags).
-- Neither side is indexable: a btree cannot serve '%term%', and the unnest subquery defeats the
-- GIN that tags would otherwise support. Every search was a sequential scan, on the hottest path
-- both the chat agent and MCP callers take.
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
-- Serves ILIKE '%term%' on name, and buys typo tolerance as a side effect.
CREATE INDEX IF NOT EXISTS "products_name_trgm_idx" ON "products" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
-- Serves the rewritten tag clause, `tags && ARRAY[...]`.
CREATE INDEX IF NOT EXISTS "products_tags_gin_idx" ON "products" USING gin ("tags");
