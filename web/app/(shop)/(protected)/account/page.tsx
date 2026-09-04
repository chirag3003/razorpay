"use client";

import { useEffect, useState } from "react";
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
import {
  getAddresses,
  createAddress,
  updateAddress,
  deleteAddress,
} from "@/lib/api/addresses";
import { updateProfile } from "@/lib/api/auth";
import { getOrders } from "@/lib/api/orders";
import { useAuthStore, handleAuthApiError } from "@/store/auth-store";
import { ApiError, ApiValidationError } from "@/lib/api/client";
import { profileSchema, type ProfileFormValues } from "@/lib/validation";
import type { AddressFormValues } from "@/lib/validation";
import type { Address } from "@/lib/types";

export default function AccountPage() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const token = useAuthStore((state) => state.token);
  const logout = useAuthStore((state) => state.logout);
  const setUser = useAuthStore((state) => state.setUser);

  const [addresses, setAddresses] = useState<Address[]>([]);
  const [orderCount, setOrderCount] = useState(0);
  const [editingAddress, setEditingAddress] = useState<Address | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    if (!token) return;
    getAddresses(token).then(setAddresses).catch((err) => {
      if (handleAuthApiError(err)) return;
      toast.error("Couldn't load your addresses");
    });
    getOrders(token)
      .then((orders) => setOrderCount(orders.length))
      .catch(() => {});
  }, [token]);

  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    values: user
      ? { name: user.name, email: user.email, phone: user.phone }
      : undefined,
  });

  async function onProfileSubmit(values: ProfileFormValues) {
    if (!token) return;
    try {
      const { user: updated } = await updateProfile(token, values);
      // Write the server's copy back into the store: the form is driven by
      // `values: user`, so skipping this resets the fields to the stale values.
      setUser(updated);
      toast.success("Profile updated");
    } catch (err) {
      if (handleAuthApiError(err)) return;
      if (err instanceof ApiValidationError) {
        for (const fieldError of err.fieldErrors) {
          form.setError(fieldError.path as keyof ProfileFormValues, {
            message: fieldError.message,
          });
        }
        return;
      }
      if (err instanceof ApiError) {
        if (err.code === "CONFLICT") {
          form.setError("email", { message: "That email is already in use" });
          return;
        }
        toast.error(err.message);
        return;
      }
      toast.error("Couldn't save your profile. Try again.");
    }
  }

  function openNewAddress() {
    setEditingAddress(null);
    setDialogOpen(true);
  }

  function openEditAddress(address: Address) {
    setEditingAddress(address);
    setDialogOpen(true);
  }

  async function handleAddressSubmit(values: AddressFormValues) {
    if (!token) return;
    try {
      if (editingAddress) {
        const updated = await updateAddress(token, editingAddress.id, values);
        setAddresses((prev) =>
          prev.map((a) => (a.id === updated.id ? updated : a))
        );
        toast.success("Address updated");
      } else {
        const created = await createAddress(token, values);
        setAddresses((prev) => [...prev, created]);
        toast.success("Address added");
      }
      setDialogOpen(false);
    } catch (err) {
      if (handleAuthApiError(err)) return;
      toast.error("Couldn't save address");
    }
  }

  async function removeAddress(id: string) {
    if (!token) return;
    try {
      await deleteAddress(token, id);
      setAddresses((prev) => prev.filter((a) => a.id !== id));
      toast.success("Address removed");
    } catch (err) {
      if (handleAuthApiError(err)) return;
      toast.error("Couldn't remove address");
    }
  }

  if (!user) return null;

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6">
      <div className="flex items-center gap-4">
        <Avatar size="lg">
          <AvatarFallback>
            {user.name
              .split(" ")
              .map((n) => n[0])
              .join("")}
          </AvatarFallback>
        </Avatar>
        <div>
          <h1 className="font-heading text-xl font-semibold">{user.name}</h1>
          <p className="text-sm text-muted-foreground">
            {orderCount} order{orderCount !== 1 && "s"} placed
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          onClick={() => {
            logout();
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
            defaultValues={
              editingAddress
                ? { ...editingAddress, line2: editingAddress.line2 ?? undefined }
                : undefined
            }
            onSubmit={handleAddressSubmit}
            submitLabel={editingAddress ? "Update address" : "Save address"}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
