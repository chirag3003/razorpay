import { pgTable, uuid, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";

// Hard Rule #4: every money-moving action is logged here with actor, mandate/scope checked,
// decision and outcome. actorType is "user" (storefront), "agent" (MCP) or "admin".
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actorType: text("actor_type").notNull(), // "user" | "agent" | "admin" | "system"
    actorId: text("actor_id").notNull(),
    action: text("action").notNull(),
    mandateScope: jsonb("mandate_scope"),
    decision: text("decision").notNull(), // "approved" | "rejected"
    outcome: text("outcome").notNull(), // "success" | "failed"
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  // This table had no index at all, which made the entire audit story unqueryable: there was no
  // way to fetch one actor's rows, or one action's, without a full scan. Both are the questions
  // the audit trail exists to answer.
  (t) => [
    index("audit_log_actor_idx").on(t.actorType, t.actorId, t.createdAt.desc()),
    index("audit_log_action_idx").on(t.action, t.createdAt.desc()),
  ]
);
