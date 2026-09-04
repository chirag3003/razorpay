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

// A request that is well-formed enough to parse but breaks a rule the schema cannot express —
// a cart line pushed over MAX_CART_ITEM_QTY by an *additive* add, for instance, where no single
// request is invalid on its own. registry.mapError turns this into `invalid_input`.
export class ValidationError extends DomainError {
  constructor(message: string) {
    super(message, 400, "VALIDATION");
  }
}

// The product exists and is sellable in principle, but not right now. Distinct from NotFoundError
// so the caller can offer an alternative rather than claim the product doesn't exist.
export class ProductUnavailableError extends DomainError {
  constructor(message: string) {
    super(message, 409, "PRODUCT_UNAVAILABLE");
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
// Thrown by reservePayService's guard chain, in the order the chain runs them.

// No mandate in a usable state. Distinct from NotFoundError: the row may exist, it just can't
// be charged.
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

// Over the per-transaction cap (token.max_amount), regardless of what is left unspent. Separate
// from InsufficientBalanceError because the fix differs: a smaller debit, not a new mandate.
export class MandateAmountExceededError extends DomainError {
  constructor(message = "Amount exceeds the mandate's per-transaction limit") {
    super(message, 400, "MANDATE_AMOUNT_EXCEEDED");
  }
}

// Not enough left in the block (amount_blocked - amount_debited). 402, not 400: the request is
// well-formed, the funds aren't there.
export class InsufficientBalanceError extends DomainError {
  constructor(message = "Insufficient blocked balance on the Reserve Pay mandate") {
    super(message, 402, "INSUFFICIENT_BLOCKED_BALANCE");
  }
}

// --- Voice (Sarvam AI) --------------------------------------------------------------------

// Sarvam refused or was unreachable. 502 for the same reason PaymentGatewayError is: the request
// was fine, the upstream let us down. The caller's recovery is to fall back to text.
export class VoiceServiceError extends DomainError {
  constructor(message = "Voice service request failed") {
    super(message, 502, "VOICE_SERVICE_ERROR");
  }
}

// SARVAM_API_KEY is unset, so voice was never configured on this deployment. 503 rather than 502:
// nothing is broken and retrying will not help — the storefront should hide the mic entirely.
export class VoiceUnavailableError extends DomainError {
  constructor(message = "Voice is not configured on this server") {
    super(message, 503, "VOICE_UNAVAILABLE");
  }
}
