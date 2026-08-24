import { Label } from "@/components/ui/label";
import { RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Address } from "@/lib/types";

export function AddressCard({
  address,
  selected,
}: {
  address: Address;
  selected: boolean;
}) {
  return (
    <Label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-xl border p-4 font-normal transition-colors",
        selected && "border-primary bg-primary/5"
      )}
    >
      <RadioGroupItem value={address.id} className="mt-0.5" />
      <div className="space-y-0.5">
        <div className="flex items-center gap-2">
          <Badge variant="outline">{address.type}</Badge>
          <span className="text-sm font-medium">{address.name}</span>
        </div>
        <p className="text-sm text-muted-foreground">
          {address.line1}
          {address.line2 && `, ${address.line2}`}, {address.city},{" "}
          {address.state} {address.pincode}
        </p>
        <p className="text-sm text-muted-foreground">{address.phone}</p>
      </div>
    </Label>
  );
}
