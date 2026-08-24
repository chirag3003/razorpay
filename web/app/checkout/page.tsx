"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, ShoppingBag } from "lucide-react";
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
import { PaymentMethodSelect, PAYMENT_METHODS } from "@/components/checkout/payment-method-select";
import { CartSummary } from "@/components/cart/cart-summary";
import { CartLineItem } from "@/components/cart/cart-line-item";
import { EmptyState } from "@/components/common/empty-state";
import { useCartSummary, useCartStore } from "@/store/cart-store";
import { getAddresses } from "@/lib/queries";
import type { Address } from "@/lib/types";
import type { AddressFormValues } from "@/lib/validation";

export default function CheckoutPage() {
  const router = useRouter();
  const { lines, subtotal, itemCount } = useCartSummary();
  const clearCart = useCartStore((state) => state.clear);

  const [step, setStep] = useState(1);
  const [addresses, setAddresses] = useState<Address[]>(() => getAddresses());
  const [selectedAddressId, setSelectedAddressId] = useState(
    () => addresses.find((a) => a.isDefault)?.id ?? addresses[0]?.id ?? ""
  );
  const [addressDialogOpen, setAddressDialogOpen] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState("");
  const [selectedPayment, setSelectedPayment] = useState("");
  const [placingOrder, setPlacingOrder] = useState(false);

  useEffect(() => {
    if (itemCount === 0 && !placingOrder) {
      router.replace("/cart");
    }
  }, [itemCount, placingOrder, router]);

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
  const selectedPaymentLabel = PAYMENT_METHODS.find(
    (p) => p.id === selectedPayment
  );

  function handleAddAddress(values: AddressFormValues) {
    const newAddress: Address = { id: `addr-${Date.now()}`, ...values };
    setAddresses((prev) => [...prev, newAddress]);
    setSelectedAddressId(newAddress.id);
    setAddressDialogOpen(false);
    toast.success("Address saved");
  }

  function placeOrder() {
    setPlacingOrder(true);
    const orderNumber = `FC-${Math.floor(100000 + Math.random() * 900000)}`;
    clearCart();
    router.push(`/checkout/success?order=${orderNumber}`);
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
              {addresses.length === 0 ? (
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
                  Continue to payment
                </Button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <h2 className="font-heading font-medium">Payment method</h2>
              <PaymentMethodSelect
                value={selectedPayment}
                onChange={setSelectedPayment}
              />
              <Separator />
              <div className="flex gap-3">
                <Button variant="outline" onClick={() => setStep(2)}>
                  Back
                </Button>
                <Button
                  className="flex-1"
                  disabled={!selectedPayment}
                  onClick={() => setStep(4)}
                >
                  Review order
                </Button>
              </div>
            </div>
          )}

          {step === 4 && selectedAddress && (
            <div className="space-y-5">
              <h2 className="font-heading font-medium">Review your order</h2>

              <div className="space-y-3">
                {lines.map((line) => (
                  <CartLineItem
                    key={line.product.id}
                    product={line.product}
                    qty={line.qty}
                    compact
                  />
                ))}
              </div>

              <Separator />

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
                <ReviewBlock title="Payment method">
                  <p>{selectedPaymentLabel?.label}</p>
                </ReviewBlock>
              </div>

              <Separator />

              <div className="flex gap-3">
                <Button variant="outline" onClick={() => setStep(3)}>
                  Back
                </Button>
                <Button className="flex-1" onClick={placeOrder}>
                  Place Order
                </Button>
              </div>
            </div>
          )}
        </Card>

        <Card className="h-fit space-y-4 p-4">
          <p className="font-heading font-medium">Order Summary</p>
          <CartSummary subtotal={subtotal} />
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
