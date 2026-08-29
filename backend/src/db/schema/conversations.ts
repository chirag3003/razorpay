import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users";
import type { MessagePart } from "../../chat/protocol";

export const CHAT_MESSAGE_ROLES = ["system", "user", "assistant", "tool"] as const;
export type ChatMessageRole = (typeof CHAT_MESSAGE_ROLES)[number];

/**
 * One storefront chat thread.
 *
 * Its id is what lands in `ToolContext.conversationId`, so every audit_log row a tool writes
 * during the thread carries it in `metadata`. That is what turns "an order was placed by an
 * agent" into "here is the conversation that placed it" on the admin dashboard — the mandate
 * chain the root claude.md asks for.
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
 * The turn log, stored twice over because the two readers want different things.
 *
 * `content` is the raw OpenRouter message — including `toolCalls` on an assistant row and the
 * tool output on a tool row — so resuming a conversation is a plain ordered select fed straight
 * back into the loop with no reconstruction step. Reconstructing model messages from rendered
 * widgets would be lossy and is the usual way a chat agent starts contradicting itself.
 *
 * `parts` is the rendered MessagePart[] for assistant rows only. That is what a `{kind:"resume"}`
 * turn replays into the transcript. The model never reads it.
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
  },
  (t) => [
    index("chat_messages_conversation_idx").on(t.conversationId, t.createdAt),
    check(
      "chat_messages_role_check",
      sql`${t.role} in (${sql.join(
        CHAT_MESSAGE_ROLES.map((r) => sql`${r}`),
        sql`, `
      )})`
    ),
  ]
);
