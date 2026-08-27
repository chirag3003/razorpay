import { DomainError } from "./DomainError";

export { DomainError };

export class NotFoundError extends DomainError {
  constructor(resource: string) {
    super(`${resource} not found`, 404, "NOT_FOUND");
  }
}

export class UnauthorizedError extends DomainError {
  constructor(message = "Unauthorized") {
    super(message, 401, "UNAUTHORIZED");
  }
}

export class ConflictError extends DomainError {
  constructor(message: string) {
    super(message, 409, "CONFLICT");
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = "Forbidden") {
    super(message, 403, "FORBIDDEN");
  }
}

export class EmptyCartError extends DomainError {
  constructor() {
    super("Cart is empty", 400, "EMPTY_CART");
  }
}

export class InvalidAddressError extends DomainError {
  constructor(message = "Address is invalid or does not belong to this user") {
    super(message, 400, "INVALID_ADDRESS");
  }
}

export class PaymentVerificationError extends DomainError {
  constructor(message = "Payment signature verification failed") {
    super(message, 400, "PAYMENT_VERIFICATION_FAILED");
  }
}

export class PaymentGatewayError extends DomainError {
  constructor(message = "Payment gateway request failed") {
    super(message, 502, "PAYMENT_GATEWAY_ERROR");
  }
}

// --- Reserve Pay (UPI SBMD) ---------------------------------------------------------------
// Thrown by reservePayService's guard chain, in the order the chain runs them. Same DomainError
// base as everything above, so app.onError, auditService, and the future agent-interfaces layer
// all handle them without a shape change.

// The user has no mandate in a usable state — never authorised one, or it's revoked/failed/
// exhausted. Distinct from NotFoundError: the row may well exist, it just can't be charged.
export class MandateNotActiveError extends DomainError {
  constructor(message = "No active Reserve Pay mandate") {
    super(message, 409, "MANDATE_NOT_ACTIVE");
  }
}

export class MandateExpiredError extends DomainError {
  constructor(message = "Reserve Pay mandate has expired") {
    super(message, 409, "MANDATE_EXPIRED");
  }
}

// The single debit exceeds the mandate's per-transaction cap (token.max_amount), regardless of
// how much is left unspent. Separate from InsufficientBalanceError because the fix differs:
// this one needs a smaller debit, that one needs a new mandate.
export class MandateAmountExceededError extends DomainError {
  constructor(message = "Amount exceeds the mandate's per-transaction limit") {
    super(message, 400, "MANDATE_AMOUNT_EXCEEDED");
  }
}

// Not enough left in the block (amount_blocked - amount_debited) to cover this debit. 402 rather
// than 400 — the request is well-formed, the funds just aren't there.
export class InsufficientBalanceError extends DomainError {
  constructor(message = "Insufficient blocked balance on the Reserve Pay mandate") {
    super(message, 402, "INSUFFICIENT_BLOCKED_BALANCE");
  }
}

// Still deferred to the agent_tokens phase — scope is a property of an agent's authority, and
// there is no agent token to scope yet.
//
// export class ScopeExceededError extends DomainError { ... }
