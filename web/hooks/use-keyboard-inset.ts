"use client";

import { useEffect, useState } from "react";

export type KeyboardViewport = {
  /** Pixels of the layout viewport covered by the on-screen keyboard. */
  inset: number;
  /** Live visual-viewport height, or null when unavailable (SSR, old browsers). */
  viewportHeight: number | null;
};

/**
 * Tracks the visual viewport so a fixed bottom sheet can stay clear of the
 * on-screen keyboard.
 *
 * iOS Safari anchors `position: fixed` to the *layout* viewport, so without
 * this a bottom sheet sits behind the keyboard. Android Chrome is handled
 * declaratively by `interactiveWidget: "resizes-content"` in the root viewport
 * export, where `inset` stays ~0 and the height simply shrinks instead.
 *
 * Callers need BOTH values: the inset lifts the sheet, and the height caps it.
 * Offsetting without capping just pushes the top off-screen.
 */
export function useKeyboardInset(enabled: boolean): KeyboardViewport {
  const [state, setState] = useState<KeyboardViewport>({
    inset: 0,
    viewportHeight: null,
  });

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const vv = window.visualViewport;
    if (!vv) return;

    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        setState({
          inset: Math.max(0, window.innerHeight - vv.height - vv.offsetTop),
          viewportHeight: vv.height,
        });
      });
    };

    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      cancelAnimationFrame(frame);
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, [enabled]);

  if (!enabled) return { inset: 0, viewportHeight: null };
  return state;
}
