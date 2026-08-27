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

// Not used yet — these slot in once the agent_tokens / mandate system exists (Days 6-7 in the
// root build order). Same DomainError base, so auditService and both calling layers (routes,
// agent-interfaces) already know how to catch/log/translate them without any shape change.
//
// export class ScopeExceededError extends DomainError { ... }
// export class MandateExpiredError extends DomainError { ... }
// export class InsufficientBalanceError extends DomainError { ... }
