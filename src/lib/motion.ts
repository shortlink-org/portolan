// The two pieces of motion that CSS cannot express on its own: a number that
// counts to its value, and the media query every animation has to obey.

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(QUERY).matches;
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia(QUERY);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/**
 * Ticks a count up to `value` on first mount. Linear over 200ms - a spring on
 * a number reads as a slot machine, and these are measurements.
 *
 * It animates once, on mount. A later change to `value` lands immediately,
 * because a re-render is not an arrival.
 */
export function useCountUp(value: number, duration = 200): number {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(() => (reduced ? value : 0));

  useEffect(() => {
    if (reduced || duration <= 0 || value === 0) {
      setShown(value);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      setShown(Math.round(value * t));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // Mount-only on purpose: see above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (reduced) setShown(value);
  }, [reduced, value]);

  return shown;
}

/** Caps a list index at the stagger ceiling: ten rows, 20ms apart, then flat. */
export function staggerStyle(index: number, cap = 10): CSSProperties {
  return { "--i": Math.min(index, cap - 1) } as CSSProperties;
}
