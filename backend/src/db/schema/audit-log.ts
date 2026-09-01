import { pgTable, uuid, text, jsonb, timestamp } from "drizzle-orm/pg-core";

// Hard Rule #4: every money-moving action is logged here with actor, mandate/scope checked,
// decision and outcome. actorType is "user" (storefront), "agent" (MCP) or "admin".
export const auditLog = pgTable("audit_log", {
  id: uuid("id").defaultRandom().primaryKey(),
  actorType: text("actor_type").notNull(), // "user" | "agent" | "admin" | "system"
  actorId: text("actor_id").notNull(),
  action: text("action").notNull(),
  mandateScope: jsonb("mandate_scope"),
  decision: text("decision").notNull(), // "approved" | "rejected"
  outcome: text("outcome").notNull(), // "success" | "failed"
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
