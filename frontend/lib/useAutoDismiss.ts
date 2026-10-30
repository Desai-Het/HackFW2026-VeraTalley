"use client";

import { useEffect, useRef } from "react";

export const SUCCESS_MESSAGE_MS = 4000;

/** Clears a success message from the page a few seconds after it appears. Errors and progress
 *  notes are left alone: they go away when the next action replaces them. */
export function useAutoDismiss(message: { kind: string } | null, clear: () => void) {
  const clearRef = useRef(clear);
  clearRef.current = clear;

  useEffect(() => {
    if (!message || message.kind !== "success") return;
    const timer = setTimeout(() => clearRef.current(), SUCCESS_MESSAGE_MS);
    return () => clearTimeout(timer);
  }, [message]);
}
