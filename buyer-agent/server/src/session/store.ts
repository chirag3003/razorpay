import type Anthropic from "@anthropic-ai/sdk";
import type { ServerEvent } from "../protocol.ts";

/**
 * An async queue with a single consumer.
 *
 * The agent loop pushes events as it goes; the SSE handler drains them. Decoupling the two is what
 * lets the loop keep working while a browser reconnects, and what lets it block on a form without
 * blocking the transport.
 */
class EventQueue {
  #buffer: ServerEvent[] = [];
  #waiter: ((value: IteratorResult<ServerEvent>) => void) | null = null;
  #closed = false;

  push(event: ServerEvent) {
    if (this.#closed) return;
    if (this.#waiter) {
      const waiter = this.#waiter;
      this.#waiter = null;
      waiter({ value: event, done: false });
      return;
    }
    this.#buffer.push(event);
  }

  close() {
    this.#closed = true;
    if (this.#waiter) {
      const waiter = this.#waiter;
      this.#waiter = null;
      waiter({ value: undefined as never, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<ServerEvent> {
    return {
      next: (): Promise<IteratorResult<ServerEvent>> => {
        const buffered = this.#buffer.shift();
        if (buffered) return Promise.resolve({ value: buffered, done: false });
        if (this.#closed) return Promise.resolve({ value: undefined as never, done: true });
        return new Promise((resolve) => {
          this.#waiter = resolve;
        });
      },
    };
  }
}

/**
 * One in-flight turn.
 *
 * A run outlives any single HTTP request on purpose: the loop parks on `await run.waitFor(id)`
 * when it needs a human, and a separate POST resolves it. Without that split, an approval or a
 * form would have to fit inside the request that started the turn.
 */
export class Run {
  readonly id = crypto.randomUUID();
  readonly queue = new EventQueue();
  #pending = new Map<string, (value: unknown) => void>();
  #aborted = false;

  constructor(readonly conversationId: string) {}

  emit(event: ServerEvent) {
    this.queue.push(event);
  }

  /** Park until the browser resolves `id`. */
  waitFor<T>(id: string): Promise<T> {
    return new Promise<T>((resolve) => {
      this.#pending.set(id, resolve as (value: unknown) => void);
    });
  }

  /** Returns false when nothing was waiting on that id — a stale or duplicated resolve. */
  resolve(id: string, value: unknown): boolean {
    const pending = this.#pending.get(id);
    if (!pending) return false;
    this.#pending.delete(id);
    pending(value);
    return true;
  }

  get aborted() {
    return this.#aborted;
  }

  /**
   * Abandon the turn. Every parked promise is resolved with a cancellation rather than left
   * dangling, or the loop would hold its tool call open forever.
   */
  abort() {
    this.#aborted = true;
    for (const [id, resolve] of this.#pending) {
      this.#pending.delete(id);
      resolve({ action: "cancel", decision: "reject", cancelled: true });
    }
    this.queue.close();
  }

  finish() {
    this.queue.close();
  }
}

export type Conversation = {
  id: string;
  messages: Anthropic.Beta.BetaMessageParam[];
  /** Sum of detected amounts allowed so far. Feeds the session cap. */
  spent: number;
};

class SessionStore {
  #conversations = new Map<string, Conversation>();
  #runs = new Map<string, Run>();

  conversation(id: string): Conversation {
    let existing = this.#conversations.get(id);
    if (!existing) {
      existing = { id, messages: [], spent: 0 };
      this.#conversations.set(id, existing);
    }
    return existing;
  }

  reset(id: string) {
    this.#conversations.delete(id);
  }

  startRun(conversationId: string): Run {
    const run = new Run(conversationId);
    this.#runs.set(run.id, run);
    return run;
  }

  run(id: string): Run | undefined {
    return this.#runs.get(id);
  }

  endRun(id: string) {
    this.#runs.delete(id);
  }
}

export const sessions = new SessionStore();
