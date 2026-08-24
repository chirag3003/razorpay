import Link from "next/link";
import { UserCircle, PackageCheck, Heart, LogIn, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function AccountMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon" aria-label="Account menu" />}
      >
        <UserCircle className="size-5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>My account</DropdownMenuLabel>
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
        <DropdownMenuItem render={<Link href="/login" />}>
          <LogIn />
          Login
        </DropdownMenuItem>
        <DropdownMenuItem render={<Link href="/signup" />}>
          <UserPlus />
          Sign up
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
