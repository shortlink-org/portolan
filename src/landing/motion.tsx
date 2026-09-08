// Motion the landing adds on top of lib/motion: things that arrive as the
// reader scrolls to them, and a hero that arrives in order. Same clock as the
// app - the narrative duration and the ease-out - so a card rising on the
// landing rises the way a row rises in the catalog.

import type { ReactNode } from "react";
import type { Variants } from "motion/react";
import { DURATION, EASE_OUT, m } from "../lib/motion";

const VIEWPORT = { once: true, margin: "-10% 0px -10% 0px" } as const;

/**
 * A block that rises the fourteen pixels once, the first time it scrolls into
 * view. `delay` staggers siblings; keep it under a third of a second, or the
 * last card in a row is still arriving when the reader has read the first.
 */
export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <m.div
      className={className}
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={VIEWPORT}
      transition={{ duration: DURATION.narrative, ease: EASE_OUT, delay }}
    >
      {children}
    </m.div>
  );
}

/** The hero's column: eyebrow, headline, copy, buttons, one after another. */
export const heroColumn: Variants = {
  hidden: {},
  shown: { transition: { staggerChildren: 0.08, delayChildren: 0.05 } },
};

export const heroLine: Variants = {
  hidden: { opacity: 0, y: 14 },
  shown: {
    opacity: 1,
    y: 0,
    transition: { duration: DURATION.narrative, ease: EASE_OUT },
  },
};
