import type { Metadata } from "next";
import { AdminHydrator } from "@/components/admin/admin-hydrator";

export const metadata: Metadata = {
  title: "FreshCart Admin",
};

/**
 * Wraps both the login page and the guarded dashboard, so the admin session is
 * hydrated before either renders. Deliberately renders no site chrome — the
 * Header/Footer live in app/(shop)/layout.tsx.
 */
export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <AdminHydrator />
      {children}
    </>
  );
}
