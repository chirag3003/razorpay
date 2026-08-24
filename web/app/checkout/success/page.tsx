import Link from "next/link";
import { CircleCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default async function CheckoutSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string }>;
}) {
  const { order } = await searchParams;

  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-4 px-4 py-16 text-center">
      <div className="flex size-16 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-500/15">
        <CircleCheck className="size-9 text-emerald-600" />
      </div>
      <h1 className="font-heading text-2xl font-semibold">
        Order placed successfully!
      </h1>
      <p className="text-muted-foreground">
        Thank you for shopping with FreshCart. We&apos;ve received your order
        and it&apos;s being prepared for delivery.
      </p>

      {order && (
        <Card className="w-full p-4">
          <p className="text-sm text-muted-foreground">Order number</p>
          <p className="font-heading text-lg font-semibold">{order}</p>
        </Card>
      )}

      <div className="mt-4 flex w-full flex-col gap-2 sm:flex-row">
        <Button
          variant="outline"
          className="flex-1"
          nativeButton={false}
          render={<Link href="/orders" />}
        >
          View Orders
        </Button>
        <Button
          className="flex-1"
          nativeButton={false}
          render={<Link href="/products" />}
        >
          Continue Shopping
        </Button>
      </div>
    </div>
  );
}
