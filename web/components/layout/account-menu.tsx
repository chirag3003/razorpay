"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { UserCircle, PackageCheck, Heart, LogIn, UserPlus, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuthStore } from "@/store/auth-store";

export function AccountMenu() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon" aria-label="Account menu" />}
      >
        <UserCircle className="size-5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{user ? user.name : "My account"}</DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuItem render={<Link href="/account" />}>
          <UserCircle />
          Profile
        </DropdownMenuItem>
        <DropdownMenuItem render={<Link href="/orders" />}>
          <PackageCheck />
          Orders
        </DropdownMenuItem>
        <DropdownMenuItem render={<Link href="/wishlist" />}>
          <Heart />
          Wishlist
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {user ? (
          <DropdownMenuItem
            onClick={() => {
              logout();
              router.push("/login");
            }}
          >
            <LogOut />
            Logout
          </DropdownMenuItem>
        ) : (
          <>
            <DropdownMenuItem render={<Link href="/login" />}>
              <LogIn />
              Login
            </DropdownMenuItem>
            <DropdownMenuItem render={<Link href="/signup" />}>
              <UserPlus />
              Sign up
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
