"use client";

import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";

export const DELIVERY_SLOTS = [
  { id: "today-2-4", day: "Today", time: "2:00 PM - 4:00 PM" },
  { id: "today-4-6", day: "Today", time: "4:00 PM - 6:00 PM" },
  { id: "today-6-8", day: "Today", time: "6:00 PM - 8:00 PM" },
  { id: "tomorrow-10-12", day: "Tomorrow", time: "10:00 AM - 12:00 PM" },
  { id: "tomorrow-12-2", day: "Tomorrow", time: "12:00 PM - 2:00 PM" },
  { id: "tomorrow-2-4", day: "Tomorrow", time: "2:00 PM - 4:00 PM" },
];

export function DeliverySlotPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <RadioGroup
      value={value}
      onValueChange={onChange}
      className="grid grid-cols-1 gap-2.5 sm:grid-cols-2"
    >
      {DELIVERY_SLOTS.map((slot) => (
        <Label
          key={slot.id}
          className={cn(
            "flex cursor-pointer items-center gap-2.5 rounded-xl border p-3 font-normal transition-colors",
            value === slot.id && "border-primary bg-primary/5"
          )}
        >
          <RadioGroupItem value={slot.id} />
          <div>
            <p className="text-sm font-medium">{slot.day}</p>
            <p className="text-xs text-muted-foreground">{slot.time}</p>
          </div>
        </Label>
      ))}
    </RadioGroup>
  );
}
