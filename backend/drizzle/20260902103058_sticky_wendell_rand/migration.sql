CREATE TABLE "sim_payments" (
	"id" text PRIMARY KEY,
	"order_id" text NOT NULL,
	"token_id" text,
	"status" text DEFAULT 'created' NOT NULL,
	"error_code" text,
	"error_description" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sim_tokens" (
	"id" text PRIMARY KEY,
	"customer_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"confirm_at" timestamp NOT NULL,
	"max_amount_paise" integer NOT NULL,
	"amount_blocked_paise" integer NOT NULL,
	"amount_debited_paise" integer DEFAULT 0 NOT NULL,
	"vpa" text,
	"expired_at" timestamp NOT NULL,
	"next_debit_error_code" text,
	"next_debit_error_description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sim_tokens_status_check" CHECK ("status" in ('pending', 'confirmed', 'paused', 'rejected', 'cancelled', 'expired', 'completed'))
);
