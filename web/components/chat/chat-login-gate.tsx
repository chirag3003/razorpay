"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useChatStore } from "@/store/chat-store";

/**
 * Shown instead of the transcript when nobody is logged in. The panel still
 * opens: bouncing straight to /login from a floating button on a public page
 * reads as broken, and this mirrors how AddToCartButton handles the same case.
 */
export function ChatLoginGate() {
  const pathname = usePathname();
  const closeChat = useChatStore((s) => s.closeChat);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-primary/10">
        <MessageSquare className="size-6 text-primary" />
      </div>
      <div className="space-y-1">
        <p className="font-heading font-medium">Shop by chat</p>
        <p className="text-sm text-muted-foreground">
          Log in and I&apos;ll find your groceries, build the cart and check out — all in
          this conversation.
        </p>
      </div>
      <Button
        className="w-full max-w-56"
        nativeButton={false}
        render={<Link href={`/login?next=${encodeURIComponent(pathname)}`} />}
        onClick={closeChat}
      >
        Log in to shop by chat
      </Button>
    </div>
  );
}
