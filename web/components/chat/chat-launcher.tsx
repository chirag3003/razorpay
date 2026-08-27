"use client";

import { usePathname } from "next/navigation";
import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChatPanel } from "@/components/chat/chat-panel";
import { useChatStore } from "@/store/chat-store";

/** Auth pages have their own focused flow — a floating assistant just competes. */
const HIDDEN_ON = ["/login", "/signup"];

export function ChatLauncher() {
  const pathname = usePathname();
  const open = useChatStore((s) => s.open);
  const openChat = useChatStore((s) => s.openChat);

  if (HIDDEN_ON.includes(pathname)) return null;

  return (
    <>
      {!open && (
        <Button
          type="button"
          aria-label="Open shopping assistant"
          onClick={openChat}
          className="fixed right-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-50 size-14 rounded-full shadow-lg sm:right-6 sm:bottom-6 sm:size-12"
        >
          <MessageCircle className="size-6" />
        </Button>
      )}
      <ChatPanel />
    </>
  );
}
