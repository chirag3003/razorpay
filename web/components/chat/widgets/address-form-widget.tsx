"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createAddress } from "@/lib/api/addresses";
import { addressSchema, type AddressFormValues } from "@/lib/validation";
import { ApiError, ApiValidationError } from "@/lib/api/client";
import { useAuthStore } from "@/store/auth-store";
import { useChatStore } from "@/store/chat-store";
import { addressOneLine } from "@/lib/chat/format";
import type { AddressFormPart, WidgetAction } from "@/lib/chat/protocol";

/**
 * A deliberately compact two-step variant of `components/checkout/address-form`.
 * That form is eight fields tall; inside an 85svh sheet with the keyboard up
 * there's roughly 200-260px of visible content, so it's unusable as-is. Same
 * `addressSchema`, same `createAddress` call — only the layout differs.
 */
const STEP_ONE_FIELDS = ["pincode", "line1", "line2"] as const;

export function AddressFormWidget({
  part,
  onAction,
}: {
  part: AddressFormPart;
  onAction: (action: WidgetAction) => void;
}) {
  const token = useAuthStore((s) => s.token);
  const refreshAddresses = useChatStore((s) => s.refreshAddresses);
  const [step, setStep] = useState<1 | 2>(1);

  const form = useForm<AddressFormValues>({
    resolver: zodResolver(addressSchema),
    defaultValues: {
      type: "Home",
      name: "",
      phone: "",
      line1: "",
      line2: "",
      city: "",
      state: "",
      pincode: "",
      ...part.prefill,
    },
  });

  async function next() {
    if (await form.trigger([...STEP_ONE_FIELDS])) setStep(2);
  }

  async function onSubmit(values: AddressFormValues) {
    if (!token) return;
    try {
      const address = await createAddress(token, values);
      await refreshAddresses();
      onAction({
        type: "address.created",
        addressId: address.id,
        oneLine: `${address.type} · ${addressOneLine(address)}`,
      });
    } catch (err) {
      if (err instanceof ApiValidationError) {
        for (const fieldError of err.fieldErrors) {
          form.setError(fieldError.path as keyof AddressFormValues, {
            message: fieldError.message,
          });
        }
        // Send the user back to whichever step owns the broken field.
        if (err.fieldErrors.some((e) => STEP_ONE_FIELDS.includes(e.path as never))) {
          setStep(1);
        }
        return;
      }
      form.setError("root", {
        message: err instanceof ApiError ? err.message : "Couldn't save that address.",
      });
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3 p-3" noValidate>
        {form.formState.errors.root && (
          <p className="text-sm text-destructive">{form.formState.errors.root.message}</p>
        )}

        {step === 1 ? (
          <>
            <FormField
              control={form.control}
              name="pincode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Pincode</FormLabel>
                  <FormControl>
                    <Input inputMode="numeric" maxLength={6} placeholder="560038" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="line1"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Flat / street</FormLabel>
                  <FormControl>
                    <Input placeholder="12 MG Road" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="line2"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Landmark (optional)</FormLabel>
                  <FormControl>
                    <Input placeholder="Near the metro" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="button" className="w-full" onClick={next}>
              Continue
            </Button>
          </>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input placeholder="Recipient" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone</FormLabel>
                    <FormControl>
                      <Input inputMode="tel" placeholder="9876543210" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <FormField
                control={form.control}
                name="city"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>City</FormLabel>
                    <FormControl>
                      <Input placeholder="Bengaluru" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="state"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>State</FormLabel>
                    <FormControl>
                      <Input placeholder="Karnataka" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Label</FormLabel>
                  <Select
                    value={field.value}
                    onValueChange={(value) => field.onChange(value as string)}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="Home">Home</SelectItem>
                      <SelectItem value="Work">Work</SelectItem>
                      <SelectItem value="Other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex gap-2">
              <Button type="button" variant="outline" size="icon" onClick={() => setStep(1)}>
                <ArrowLeft className="size-4" />
                <span className="sr-only">Back</span>
              </Button>
              <Button type="submit" className="flex-1" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting && <Loader2 className="size-4 animate-spin" />}
                Save &amp; continue
              </Button>
            </div>
          </>
        )}
      </form>
    </Form>
  );
}
