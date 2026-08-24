"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { LogOut, Pencil, Plus, Trash2 } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { AddressForm } from "@/components/checkout/address-form";
import { getAddresses, getOrders } from "@/lib/queries";
import { defaultAddress } from "@/data/orders";
import { profileSchema, type ProfileFormValues } from "@/lib/validation";
import type { AddressFormValues } from "@/lib/validation";
import type { Address } from "@/lib/types";

export default function AccountPage() {
  const router = useRouter();
  const [addresses, setAddresses] = useState<Address[]>(() => getAddresses());
  const [editingAddress, setEditingAddress] = useState<Address | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const orderCount = getOrders().length;

  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      name: defaultAddress.name,
      email: "aarav.sharma@example.com",
      phone: defaultAddress.phone,
    },
  });

  function onProfileSubmit() {
    toast.success("Profile updated");
  }

  function openNewAddress() {
    setEditingAddress(null);
    setDialogOpen(true);
  }

  function openEditAddress(address: Address) {
    setEditingAddress(address);
    setDialogOpen(true);
  }

  function handleAddressSubmit(values: AddressFormValues) {
    if (editingAddress) {
      setAddresses((prev) =>
        prev.map((a) =>
          a.id === editingAddress.id ? { ...editingAddress, ...values } : a
        )
      );
      toast.success("Address updated");
    } else {
      setAddresses((prev) => [
        ...prev,
        { id: `addr-${Date.now()}`, ...values },
      ]);
      toast.success("Address added");
    }
    setDialogOpen(false);
  }

  function removeAddress(id: string) {
    setAddresses((prev) => prev.filter((a) => a.id !== id));
    toast.success("Address removed");
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6">
      <div className="flex items-center gap-4">
        <Avatar size="lg">
          <AvatarFallback>
            {defaultAddress.name
              .split(" ")
              .map((n) => n[0])
              .join("")}
          </AvatarFallback>
        </Avatar>
        <div>
          <h1 className="font-heading text-xl font-semibold">
            {defaultAddress.name}
          </h1>
          <p className="text-sm text-muted-foreground">
            {orderCount} order{orderCount !== 1 && "s"} placed
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          onClick={() => {
            toast.success("Logged out");
            router.push("/login");
          }}
        >
          <LogOut className="size-4" />
          Logout
        </Button>
      </div>

      <Card className="space-y-4 p-5">
        <p className="font-heading font-medium">Profile details</p>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onProfileSubmit)}
            className="space-y-4"
            noValidate
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Full name</FormLabel>
                    <FormControl>
                      <Input {...field} />
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
                    <FormLabel>Phone number</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input type="email" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit">Save changes</Button>
          </form>
        </Form>
      </Card>

      <Card className="space-y-4 p-5">
        <div className="flex items-center justify-between">
          <p className="font-heading font-medium">Saved addresses</p>
          <Button variant="outline" size="sm" onClick={openNewAddress}>
            <Plus className="size-4" />
            Add address
          </Button>
        </div>
        <div className="space-y-3">
          {addresses.map((address, index) => (
            <div key={address.id}>
              {index > 0 && <Separator className="mb-3" />}
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="mb-1 flex items-center gap-2">
                    <Badge variant="outline">{address.type}</Badge>
                    <span className="text-sm font-medium">
                      {address.name}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {address.line1}
                    {address.line2 && `, ${address.line2}`}, {address.city},{" "}
                    {address.state} {address.pincode}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {address.phone}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Edit address"
                    onClick={() => openEditAddress(address)}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Delete address"
                    onClick={() => removeAddress(address.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingAddress ? "Edit address" : "Add new address"}
            </DialogTitle>
          </DialogHeader>
          <AddressForm
            key={editingAddress?.id ?? "new"}
            defaultValues={editingAddress ?? undefined}
            onSubmit={handleAddressSubmit}
            submitLabel={editingAddress ? "Update address" : "Save address"}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
