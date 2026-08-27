"use client";

import { isPartInteractive, type MessagePart, type WidgetAction } from "@/lib/chat/protocol";
import { useChatStore } from "@/store/chat-store";
import { WidgetFrame } from "@/components/chat/widgets/widget-frame";
import { QuickRepliesWidget } from "@/components/chat/widgets/quick-replies-widget";
import { ProductResultsWidget } from "@/components/chat/widgets/product-results-widget";
import { CartSummaryWidget } from "@/components/chat/widgets/cart-summary-widget";
import { AddressPickerWidget } from "@/components/chat/widgets/address-picker-widget";
import { AddressFormWidget } from "@/components/chat/widgets/address-form-widget";
import { SlotPickerWidget } from "@/components/chat/widgets/slot-picker-widget";
import { OrderReviewWidget } from "@/components/chat/widgets/order-review-widget";
import { ReservePaySetupWidget } from "@/components/chat/widgets/reserve-pay-setup-widget";
import { ReservePayStatusWidget } from "@/components/chat/widgets/reserve-pay-status-widget";
import { OrderConfirmationWidget } from "@/components/chat/widgets/order-confirmation-widget";
import { ErrorWidget } from "@/components/chat/widgets/error-widget";

/** One-line replacement shown once a transient widget has been answered. */
function summaryFor(part: MessagePart, action: WidgetAction): string | null {
  switch (action.type) {
    case "address.select":
    case "address.created":
      return action.oneLine;
    case "slot.select":
      return action.label;
    case "review.confirm":
      return "Order confirmed";
    case "review.edit":
      return `Changing ${action.target}`;
    case "reserve_pay.cancel":
      return "Skipped setting up a reserve";
    case "reserve_pay.top_up":
      return "Topping up your reserve";
    case "reserve_pay.renew":
      return "Setting up a new reserve";
    case "address.add_requested":
      return "Adding a new address";
    case "retry":
      return "Retried";
    default:
      return part.type === "error" ? "Handled" : null;
  }
}

export function WidgetPart({ part }: { part: MessagePart }) {
  const interactive = useChatStore((s) =>
    isPartInteractive(part, { activePartId: s.activePartId, resolutions: s.resolutions })
  );
  const resolution = useChatStore((s) => s.resolutions[part.partId]);
  const dispatch = useChatStore((s) => s.dispatch);

  const onAction = (action: WidgetAction) => void dispatch(part.partId, action);
  const answered = resolution !== undefined;
  const summary = resolution ? summaryFor(part, resolution) : null;

  // Text and directives are not widgets; the message renderer handles text and
  // the store swallows directives before they ever reach here.
  if (part.type === "text" || part.type === "client_directive") return null;

  // Chips are chrome — they vanish rather than freezing into dead buttons.
  if (part.type === "quick_replies") {
    return (
      <QuickRepliesWidget
        part={part}
        interactive={interactive}
        answered={answered}
        onAction={onAction}
      />
    );
  }

  return (
    <WidgetFrame interactive={interactive} answered={answered} summary={summary}>
      {renderBody()}
    </WidgetFrame>
  );

  function renderBody() {
    switch (part.type) {
      case "product_results":
        return <ProductResultsWidget part={part} onAction={onAction} />;
      case "cart_summary":
        return <CartSummaryWidget part={part} onAction={onAction} />;
      case "address_picker":
        return <AddressPickerWidget part={part} onAction={onAction} />;
      case "address_form":
        return <AddressFormWidget part={part} onAction={onAction} />;
      case "slot_picker":
        return <SlotPickerWidget part={part} onAction={onAction} />;
      case "order_review":
        return <OrderReviewWidget part={part} interactive={interactive} onAction={onAction} />;
      case "reserve_pay_setup":
        return (
          <ReservePaySetupWidget part={part} interactive={interactive} onAction={onAction} />
        );
      case "reserve_pay_status":
        return (
          <ReservePayStatusWidget part={part} interactive={interactive} onAction={onAction} />
        );
      case "order_confirmation":
        return <OrderConfirmationWidget part={part} />;
      case "error":
        return <ErrorWidget part={part} interactive={interactive} onAction={onAction} />;
      default:
        return null;
    }
  }
}
