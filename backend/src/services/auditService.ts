import { db } from "../db";
import { auditLog } from "../db/schema";

type ActorType = "user" | "agent" | "system" | "admin";
type Decision = "approved" | "rejected";
type Outcome = "success" | "failed";

export async function log(params: {
  actorType: ActorType;
  actorId: string;
  action: string;
  mandateScope?: unknown;
  decision: Decision;
  outcome: Outcome;
  metadata?: unknown;
}) {
  await db.insert(auditLog).values({
    actorType: params.actorType,
    actorId: params.actorId,
    action: params.action,
    mandateScope: params.mandateScope ?? null,
    decision: params.decision,
    outcome: params.outcome,
    metadata: params.metadata ?? null,
  });
}
