import { pgTable, uuid, text, jsonb, timestamp } from "drizzle-orm/pg-core";

// Hard Rule #4 (root claude.md): every money-moving action must be logged here with actor,
// mandate/scope checked, decision, and outcome. actorType/mandateScope are already shaped for
// the future agent_tokens system — this phase only ever writes actorType "user" with a null
// mandateScope, since there's nothing to check yet.
export const auditLog = pgTable("audit_log", {
  id: uuid("id").defaultRandom().primaryKey(),
  actorType: text("actor_type").notNull(), // "user" | "agent" | "system"
  actorId: text("actor_id").notNull(),
  action: text("action").notNull(),
  mandateScope: jsonb("mandate_scope"),
  decision: text("decision").notNull(), // "approved" | "rejected"
  outcome: text("outcome").notNull(), // "success" | "failed"
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
