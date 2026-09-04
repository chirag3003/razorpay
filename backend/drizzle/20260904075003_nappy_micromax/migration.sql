-- chat_messages gains a total insertion order.
--
-- created_at could never provide one: defaultNow() is Postgres now() = TRANSACTION START time,
-- and persistTurn writes a whole turn in a single transaction, so every row of a turn shares one
-- timestamp. Ordering by it returned a turn's rows in arbitrary order, detaching `tool` rows from
-- the `assistant` row that called them — which makes the LLM provider hang outright.
--
-- Backfill: ADD COLUMN ... bigserial rewrites the table and assigns nextval() in physical (heap)
-- order. These rows are insert-only and never updated, so heap order IS insertion order — verified
-- against the live data before writing this (ordering by ctid produced a perfectly coherent
-- user/assistant/tool transcript, where ordering by created_at produced six orphaned tool rows).
ALTER TABLE "chat_messages" ADD COLUMN "seq" bigserial;--> statement-breakpoint
DROP INDEX "chat_messages_conversation_idx";--> statement-breakpoint
CREATE INDEX "chat_messages_conversation_idx" ON "chat_messages" ("conversation_id","seq");