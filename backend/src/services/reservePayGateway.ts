import { env } from "../config/env";
import * as paymentService from "./paymentService";
import type { RazorpayTokenResponse } from "./paymentService";
import * as sim from "./reservePaySimService";

// Picks who answers the Reserve Pay gateway calls: Razorpay, or the local simulator. One choice,
// made once at import, because RESERVE_PAY_SIM cannot change while the process runs.
//
// In real mode every function here is a straight pass-through, so paymentService remains the only
// place raw gateway calls live. The simulator exists because Razorpay has not provisioned the S2S
// payment API on this account — see backend/issues.md.

/**
 * Deliberately narrower than what paymentService returns: only the fields reservePayService
 * actually reads. That is what lets a simulated response satisfy the same contract without
 * fabricating an entire Razorpay entity.
 */
export type ReservePayGateway = {
  createRazorpayCustomer(params: {
    name: string;
    email: string;
    contact: string;
  }): Promise<string>;

  createReservePayAuthOrder(params: {
    amountPaise: number;
    customerId: string;
    receipt: string;
    description: string;
    expireAt: number;
  }): Promise<{ id: string }>;

  createReservePayAuthPayment(params: {
    amountPaise: number;
    orderId: string;
    customerId: string;
    contact: string;
    email: string;
  }): Promise<{ razorpayPaymentId: string; intentUrl: string | null }>;

  fetchPayment(paymentId: string): Promise<{
    token_id?: string | null;
    status?: string;
    error_description?: string | null;
  }>;

  fetchCustomerToken(customerId: string, tokenId: string): Promise<RazorpayTokenResponse>;

  createReservePayDebitOrder(params: {
    amountPaise: number;
    receipt: string;
    notes?: Record<string, string>;
  }): Promise<{ id: string }>;

  createReservePayDebitPayment(params: {
    amountPaise: number;
    orderId: string;
    customerId: string;
    tokenId: string;
    contact: string;
    email: string;
    description?: string;
    notes?: Record<string, string>;
  }): Promise<{
    razorpay_payment_id: string;
    razorpay_order_id: string;
    razorpay_signature: string;
  }>;

  cancelReservePayToken(
    customerId: string,
    tokenId: string
  ): Promise<{ id: string; status: string }>;
};

const real: ReservePayGateway = {
  createRazorpayCustomer: paymentService.createRazorpayCustomer,
  createReservePayAuthOrder: paymentService.createReservePayAuthOrder,
  createReservePayAuthPayment: paymentService.createReservePayAuthPayment,
  fetchPayment: paymentService.fetchPayment,
  fetchCustomerToken: paymentService.fetchCustomerToken,
  createReservePayDebitOrder: paymentService.createReservePayDebitOrder,
  createReservePayDebitPayment: paymentService.createReservePayDebitPayment,
  cancelReservePayToken: paymentService.cancelReservePayToken,
};

const simulated: ReservePayGateway = {
  createRazorpayCustomer: sim.createRazorpayCustomer,
  createReservePayAuthOrder: sim.createReservePayAuthOrder,
  createReservePayAuthPayment: sim.createReservePayAuthPayment,
  fetchPayment: sim.fetchPayment,
  fetchCustomerToken: sim.fetchCustomerToken,
  createReservePayDebitOrder: sim.createReservePayDebitOrder,
  createReservePayDebitPayment: sim.createReservePayDebitPayment,
  cancelReservePayToken: sim.cancelReservePayToken,
};

export const gateway: ReservePayGateway = env.RESERVE_PAY_SIM ? simulated : real;
