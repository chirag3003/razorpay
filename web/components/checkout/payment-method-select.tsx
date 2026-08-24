"use client";

import { Smartphone, CreditCard, Landmark, Banknote } from "lucide-react";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";

export const PAYMENT_METHODS = [
  { id: "upi", label: "UPI", description: "Pay via any UPI app", icon: Smartphone },
  { id: "card", label: "Credit / Debit Card", description: "Visa, Mastercard, Rupay", icon: CreditCard },
  { id: "netbanking", label: "Net Banking", description: "All major banks supported", icon: Landmark },
  { id: "cod", label: "Cash on Delivery", description: "Pay when your order arrives", icon: Banknote },
];

export function PaymentMethodSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <RadioGroup value={value} onValueChange={onChange} className="gap-2.5">
      {PAYMENT_METHODS.map((method) => (
        <Label
          key={method.id}
          className={cn(
            "flex cursor-pointer items-center gap-3 rounded-xl border p-3.5 font-normal transition-colors",
            value === method.id && "border-primary bg-primary/5"
          )}
        >
          <RadioGroupItem value={method.id} />
          <method.icon className="size-5 text-primary" />
          <div>
            <p className="text-sm font-medium">{method.label}</p>
            <p className="text-xs text-muted-foreground">
              {method.description}
            </p>
          </div>
        </Label>
      ))}
    </RadioGroup>
  );
}
