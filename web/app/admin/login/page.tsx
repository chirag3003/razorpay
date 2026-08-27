"use client";

import { Suspense, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { adminLoginSchema, type AdminLoginFormValues } from "@/lib/validation";
import { useAdminAuthStore } from "@/store/admin-auth-store";
import { ApiError } from "@/lib/api/client";

function AdminLoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const login = useAdminAuthStore((state) => state.login);
  const status = useAdminAuthStore((state) => state.status);
  const next = searchParams.get("next") ?? "/admin";

  const form = useForm<AdminLoginFormValues>({
    resolver: zodResolver(adminLoginSchema),
    defaultValues: { password: "" },
  });

  useEffect(() => {
    if (status === "authenticated") router.replace(next);
  }, [status, next, router]);

  async function onSubmit(values: AdminLoginFormValues) {
    try {
      await login(values.password);
      router.replace(next);
    } catch (err) {
      // 401 is the only realistic failure here, and it always means the
      // password is wrong — so it belongs on the field, not in the root slot.
      if (err instanceof ApiError && err.code === "UNAUTHORIZED") {
        form.setError("password", { message: "Incorrect password" });
        return;
      }
      if (err instanceof ApiError) {
        form.setError("root", { message: err.message });
        return;
      }
      form.setError("root", { message: "Something went wrong. Try again." });
    }
  }

  return (
    <div className="flex min-h-svh flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-primary/10">
            <ShieldCheck className="size-6 text-primary" />
          </div>
          <div className="space-y-1">
            <h1 className="font-heading text-2xl font-semibold">
              FreshCart Admin
            </h1>
            <p className="text-sm text-muted-foreground">
              Enter the admin password to manage the store
            </p>
          </div>
        </div>

        <Card className="p-5">
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(onSubmit)}
              className="space-y-4"
              noValidate
            >
              {form.formState.errors.root && (
                <p className="text-sm text-destructive">
                  {form.formState.errors.root.message}
                </p>
              )}
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Admin password</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        placeholder="••••••••"
                        autoComplete="current-password"
                        autoFocus
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button
                type="submit"
                className="w-full"
                disabled={form.formState.isSubmitting}
              >
                {form.formState.isSubmitting ? "Signing in…" : "Sign in"}
              </Button>
            </form>
          </Form>
        </Card>

        <p className="mt-4 text-center text-sm text-muted-foreground">
          <Link href="/" className="font-medium text-primary hover:underline">
            Back to storefront
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function AdminLoginPage() {
  // useSearchParams needs a Suspense boundary above it.
  return (
    <Suspense fallback={null}>
      <AdminLoginContent />
    </Suspense>
  );
}
