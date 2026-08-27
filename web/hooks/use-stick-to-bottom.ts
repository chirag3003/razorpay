"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const NEAR_BOTTOM_PX = 64;

/**
 * Keeps a scroll container pinned to the bottom while content grows, and gets
 * out of the way the moment the user scrolls up to read.
 *
 * Pinning is instant rather than smooth on purpose — smooth scrolling visibly
 * lags behind streaming tokens.
 */
export function useStickToBottom<T extends HTMLElement>() {
  const scrollRef = useRef<T | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const pinnedRef = useRef(true);
  const [pinned, setPinned] = useState(true);

  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    pinnedRef.current = true;
    setPinned(true);
  }, []);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const next = distance <= NEAR_BOTTOM_PX;
    if (next !== pinnedRef.current) {
      pinnedRef.current = next;
      setPinned(next);
    }
  }, []);

  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const observer = new ResizeObserver(() => {
      if (!pinnedRef.current) return;
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  return { scrollRef, contentRef, pinned, onScroll, scrollToBottom };
}
