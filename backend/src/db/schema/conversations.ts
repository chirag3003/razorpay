import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  index,
  bigserial,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users";
import type { MessagePart } from "../../chat/protocol";

export const CHAT_MESSAGE_ROLES = ["system", "user", "assistant", "tool"] as const;
export type ChatMessageRole = (typeof CHAT_MESSAGE_ROLES)[number];

/**
 * One storefront chat thread. Its id lands in `ToolContext.conversationId`, so every audit_log
 * row a tool writes during the thread carries it in `metadata` — which is what turns "an order
 * was placed by an agent" into "here is the conversation that placed it".
 */
export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // First user message, truncated. Purely for a future "past chats" list.
    title: text("title"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("conversations_user_updated_idx").on(t.userId, t.updatedAt.desc())]
);

/**
 * The turn log, stored twice because the two readers want different things.
 *
 * `content` is the raw OpenRouter message (toolCalls included), so resuming is an ordered select
 * fed straight back into the loop with no reconstruction step — reconstructing model messages
 * from rendered widgets is lossy.
 *
 * `parts` is the rendered MessagePart[], assistant rows only, replayed by a `{kind:"resume"}`
 * turn. The model never reads it.
 */
export const chatMessages = pgTable(
  "chat_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    content: jsonb("content").$type<Record<string, unknown>>().notNull(),
    parts: jsonb("parts").$type<MessagePart[]>(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    /**
     * Total insertion order, and the ONLY column safe to order a transcript by.
     *
     * `createdAt` cannot do it: `defaultNow()` emits Postgres `now()`, which is *transaction
     * start* time, and persistTurn writes a whole turn in one transaction — so every row of a
     * turn carries an identical timestamp. Ordering by it alone returns a turn's rows in
     * arbitrary order, which interleaves `tool` rows away from the `assistant` row that called
     * them. That is not cosmetic: a `tool` message whose matching `assistant` does not precede
     * it makes the provider hang, with no error and no log.
     */
    seq: bigserial("seq", { mode: "number" }).notNull(),
  },
  (t) => [
    index("chat_messages_conversation_idx").on(t.conversationId, t.seq),
    check(
      "chat_messages_role_check",
      sql`${t.role} in (${sql.join(
        CHAT_MESSAGE_ROLES.map((r) => sql`${r}`),
        sql`, `
      )})`
    ),
  ]
);
