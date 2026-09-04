"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2, MailCheck, Plus, ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { RadioGroup } from "@/components/ui/radio-group";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CheckoutStepper } from "@/components/checkout/checkout-stepper";
import { AddressCard } from "@/components/checkout/address-card";
import { AddressForm } from "@/components/checkout/address-form";
import { DeliverySlotPicker, DELIVERY_SLOTS } from "@/components/checkout/delivery-slot-picker";
import { CartSummary } from "@/components/cart/cart-summary";
import { CartLineItem } from "@/components/cart/cart-line-item";
import { EmptyState } from "@/components/common/empty-state";
import { useCartSummary, useCartStore } from "@/store/cart-store";
import { useAuthStore, handleAuthApiError } from "@/store/auth-store";
import { getAddresses, createAddress } from "@/lib/api/addresses";
import { initiateCheckout, verifyCheckout } from "@/lib/api/checkout";
import { getOrders } from "@/lib/api/orders";
import { loadRazorpayCheckout } from "@/lib/razorpay";
import { ApiError } from "@/lib/api/client";
import type { Address } from "@/lib/types";
import type { AddressFormValues } from "@/lib/validation";

/** Long enough for the webhook to land, short enough not to feel abandoned. */
const CONFIRM_POLL_MS = 3000;
const CONFIRM_ATTEMPTS = 10;

export default function CheckoutPage() {
  const router = useRouter();
  const { lines, subtotal, deliveryFee, total, itemCount } = useCartSummary();
  const fetchCart = useCartStore((state) => state.fetchCart);
  const token = useAuthStore((state) => state.token);
  const user = useAuthStore((state) => state.user);

  const [step, setStep] = useState(1);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [addressesLoading, setAddressesLoading] = useState(true);
  const [selectedAddressId, setSelectedAddressId] = useState("");
  const [addressDialogOpen, setAddressDialogOpen] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState("");
  const [placingOrder, setPlacingOrder] = useState(false);
  // Set when the payment was captured but /verify didn't come back: the order
  // exists (or shortly will, via the payment.captured webhook), so this polls
  // for it rather than telling the customer their payment failed.
  const [confirmingOrderId, setConfirmingOrderId] = useState<string | null>(null);
  const [confirmTimedOut, setConfirmTimedOut] = useState(false);

  useEffect(() => {
    if (!token) return;
    getAddresses(token)
      .then((fetched) => {
        setAddresses(fetched);
        setSelectedAddressId(
          fetched.find((a) => a.isDefault)?.id ?? fetched[0]?.id ?? ""
        );
      })
      .catch((err) => {
        if (handleAuthApiError(err)) return;
        toast.error("Couldn't load your addresses");
      })
      .finally(() => setAddressesLoading(false));
  }, [token]);

  useEffect(() => {
    if (itemCount === 0 && !placingOrder) {
      router.replace("/cart");
    }
  }, [itemCount, placingOrder, router]);

  // Money has already moved by the time this runs, so it never resolves to an
  // error: it either finds the order or hands the customer a reassurance state.
  // The order is written server-side by the `payment.captured` webhook even when
  // the /verify call the client made never came back.
  useEffect(() => {
    if (!confirmingOrderId || !token) return;
    let ignore = false;
    let attempts = 0;

    async function poll() {
      attempts += 1;
      try {
        const orders = await getOrders(token!);
        const match = orders.find(
          (order) => order.razorpayOrderId === confirmingOrderId
        );
        if (ignore) return;
        if (match) {
          clearInterval(id);
          await fetchCart();
          router.push(`/checkout/success?order=${match.orderNumber}`);
          return;
        }
      } catch {
        // Keep polling — a failed poll says nothing about the payment.
      }
      if (!ignore && attempts >= CONFIRM_ATTEMPTS) {
        clearInterval(id);
        setConfirmTimedOut(true);
      }
    }

    const id = setInterval(() => void poll(), CONFIRM_POLL_MS);
    void poll();

    return () => {
      ignore = true;
      clearInterval(id);
    };
  }, [confirmingOrderId, token, router, fetchCart]);

  if (confirmingOrderId) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <Card className="flex flex-col items-center gap-3 p-8 text-center">
          {confirmTimedOut ? (
            <>
              <MailCheck className="size-8 text-primary" />
              <h1 className="font-heading text-xl font-semibold">
                Your payment went through
              </h1>
              <p className="text-sm text-muted-foreground">
                We&apos;re still confirming the order on our side. It will appear
                in your orders shortly — if it doesn&apos;t, we&apos;ll email you.
                You have not been charged twice.
              </p>
              <Button
                className="mt-2"
                nativeButton={false}
                render={<Link href="/orders" />}
              >
                View my orders
              </Button>
            </>
          ) : (
            <>
              <Loader2 className="size-8 animate-spin text-muted-foreground" />
              <h1 className="font-heading text-xl font-semibold">
                Confirming your payment
              </h1>
              <p className="text-sm text-muted-foreground">
                Your payment went through. We&apos;re finishing up your order —
                please don&apos;t close this window.
              </p>
            </>
          )}
        </Card>
      </div>
    );
  }

  if (itemCount === 0) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-6">
        <EmptyState
          icon={ShoppingBag}
          title="Your cart is empty"
          description="Add items to your cart before checking out."
          action={{ label: "Start shopping", href: "/products" }}
        />
      </div>
    );
  }

  const selectedAddress = addresses.find((a) => a.id === selectedAddressId);
  const selectedSlotLabel = DELIVERY_SLOTS.find((s) => s.id === selectedSlot);

  async function handleAddAddress(values: AddressFormValues) {
    if (!token) return;
    try {
      const address = await createAddress(token, values);
      setAddresses((prev) => [...prev, address]);
      setSelectedAddressId(address.id);
      setAddressDialogOpen(false);
      toast.success("Address saved");
    } catch (err) {
      if (handleAuthApiError(err)) return;
      toast.error("Couldn't save address");
    }
  }

  async function placeOrder() {
    if (!token || !user || !selectedAddress || !selectedSlotLabel) {
      return;
    }
    setPlacingOrder(true);

    try {
      const init = await initiateCheckout(token, {
        addressId: selectedAddress.id,
        deliverySlot: `${selectedSlotLabel.day}, ${selectedSlotLabel.time}`,
      });

      await loadRazorpayCheckout();

      new window.Razorpay!({
        key: init.keyId,
        amount: init.amount,
        currency: init.currency,
        order_id: init.razorpayOrderId,
        name: "FreshCart",
        prefill: { name: user.name, email: user.email, contact: user.phone },
        handler: async (response) => {
          try {
            const order = await verifyCheckout(token, {
              razorpayOrderId: response.razorpay_order_id,
              razorpayPaymentId: response.razorpay_payment_id,
              razorpaySignature: response.razorpay_signature,
            });
            await fetchCart();
            router.push(`/checkout/success?order=${order.orderNumber}`);
          } catch (err) {
            // A bad signature is a real failure and keeps its error path. Every
            // other error here lands *after* capture — a network blip in the
            // moment after the money moved — and must never be presented as a
            // failed payment.
            if (
              err instanceof ApiError &&
              err.code === "PAYMENT_VERIFICATION_FAILED"
            ) {
              toast.error(err.message);
              setPlacingOrder(false);
              return;
            }
            setConfirmingOrderId(init.razorpayOrderId);
          }
        },
        modal: {
          ondismiss: () => setPlacingOrder(false),
        },
      }).open();
    } catch (err) {
      setPlacingOrder(false);
      if (handleAuthApiError(err)) return;
      toast.error(
        err instanceof ApiError ? err.message : "Couldn't start checkout"
      );
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <h1 className="mb-6 font-heading text-2xl font-semibold">Checkout</h1>
      <div className="mb-8">
        <CheckoutStepper current={step} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <Card className="p-5">
          {step === 1 && (
            <div className="space-y-4">
              <h2 className="font-heading font-medium">Delivery address</h2>
              {addressesLoading ? (
                <p className="text-sm text-muted-foreground">
                  Loading addresses…
                </p>
              ) : addresses.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  You have no saved addresses yet.
                </p>
              ) : (
                <RadioGroup
                  value={selectedAddressId}
                  onValueChange={setSelectedAddressId}
                  className="gap-2.5"
                >
                  {addresses.map((address) => (
                    <AddressCard
                      key={address.id}
                      address={address}
                      selected={address.id === selectedAddressId}
                    />
                  ))}
                </RadioGroup>
              )}
              <Button
                type="button"
                variant="outline"
                onClick={() => setAddressDialogOpen(true)}
              >
                <Plus className="size-4" />
                Add new address
              </Button>
              <Separator />
              <Button
                className="w-full"
                disabled={!selectedAddressId}
                onClick={() => setStep(2)}
              >
                Continue to delivery slot
              </Button>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <h2 className="font-heading font-medium">
                Choose a delivery slot
              </h2>
              <DeliverySlotPicker
                value={selectedSlot}
                onChange={setSelectedSlot}
              />
              <Separator />
              <div className="flex gap-3">
                <Button variant="outline" onClick={() => setStep(1)}>
                  Back
                </Button>
                <Button
                  className="flex-1"
                  disabled={!selectedSlot}
                  onClick={() => setStep(3)}
                >
                  Review order
                </Button>
              </div>
            </div>
          )}

          {step === 3 && selectedAddress && (
            <div className="space-y-5">
              <h2 className="font-heading font-medium">Review your order</h2>

              <div className="space-y-3">
                {lines.map((line) => (
                  <CartLineItem
                    key={line.itemId}
                    itemId={line.itemId}
                    product={line.product}
                    qty={line.qty}
                    compact
                  />
                ))}
              </div>

              <Separator />

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <ReviewBlock title="Deliver to">
                  <p className="font-medium">{selectedAddress.name}</p>
                  <p>
                    {selectedAddress.line1}, {selectedAddress.city}{" "}
                    {selectedAddress.pincode}
                  </p>
                </ReviewBlock>
                <ReviewBlock title="Delivery slot">
                  <p>
                    {selectedSlotLabel?.day} · {selectedSlotLabel?.time}
                  </p>
                </ReviewBlock>
              </div>

              <Separator />

              <p className="text-sm text-muted-foreground">
                You&apos;ll choose how to pay (UPI, card, net banking, and more) on
                the secure Razorpay screen.
              </p>

              <div className="flex gap-3">
                <Button variant="outline" onClick={() => setStep(2)} disabled={placingOrder}>
                  Back
                </Button>
                <Button className="flex-1" onClick={placeOrder} disabled={placingOrder}>
                  {placingOrder ? "Placing order…" : "Place Order"}
                </Button>
              </div>
            </div>
          )}
        </Card>

        <Card className="h-fit space-y-4 p-4">
          <p className="font-heading font-medium">Order Summary</p>
          <CartSummary subtotal={subtotal} deliveryFee={deliveryFee} total={total} />
        </Card>
      </div>

      <Dialog open={addressDialogOpen} onOpenChange={setAddressDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add new address</DialogTitle>
          </DialogHeader>
          <AddressForm onSubmit={handleAddAddress} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ReviewBlock({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1 rounded-lg border p-3 text-sm text-muted-foreground">
      <p className="text-xs font-medium tracking-wide text-foreground uppercase">
        {title}
      </p>
      {children}
    </div>
  );
}
