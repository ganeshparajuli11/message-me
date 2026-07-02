"use client";

import { useEffect, useState } from "react";

/**
 * Render-pure clock: returns a timestamp that refreshes every `intervalMs`,
 * so presence ("online"/"last seen") stays current without impure
 * Date.now() calls during render.
 */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
