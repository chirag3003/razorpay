import { Truck, BadgePercent, Sprout, Clock } from "lucide-react";

const items = [
  { icon: Truck, text: "Free delivery above ₹199" },
  { icon: Clock, text: "Delivered in under 60 minutes" },
  { icon: Sprout, text: "Farm-fresh, sourced daily" },
  { icon: BadgePercent, text: "Everyday low prices" },
];

export function PromoStrip() {
  return (
    <div className="grid grid-cols-2 gap-3 rounded-2xl bg-primary/5 p-4 sm:grid-cols-4">
      {items.map((item) => (
        <div key={item.text} className="flex items-center gap-2.5">
          <item.icon className="size-5 shrink-0 text-primary" />
          <span className="text-sm font-medium">{item.text}</span>
        </div>
      ))}
    </div>
  );
}
