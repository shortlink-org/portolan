// Motion, in two halves.
//
// CSS owns what appears and what changes colour: a page rising on mount, a
// row hovered, a stagger of cards. That is `page-in`, `stagger-in`, `t-micro`
// in index.css, driven by the tokens declared there.
//
// Motion (motion.dev) owns the three things CSS cannot say on its own: an
// element that leaves (an exit needs the node to stay mounted while it goes),
// an element that changes place or size (layout), and an element that is the
// same thing in two places (a tab indicator that slides, `layoutId`).
//
// The two halves share one clock. The durations and easings below are the CSS
// tokens spelled as numbers; motion.test.ts holds them to index.css so the
// two cannot drift.

import { useEffect, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  AnimatePresence,
  LayoutGroup,
  LazyMotion,
  MotionConfig,
  m,
} from "motion/react";
import type { TargetAndTransition, Transition } from "motion/react";

export { AnimatePresence, LayoutGroup, m };

/* ---------------------------------------------------------------------------
   The clock: index.css --dur-* and --ease-*, as Motion reads them.
   --------------------------------------------------------------------------- */

/** Seconds. `--dur-micro` and friends in index.css, divided by a thousand. */
export const DURATION = {
  micro: 0.15,
  panel: 0.25,
  page: 0.25,
  narrative: 0.4,
} as const;

/** `--ease-out`: fast out, long settle. Anything that arrives or leaves. */
export const EASE_OUT = [0.2, 0, 0, 1] as const;
/** `--ease-in-out`: symmetric. Anything that changes in place. */
export const EASE_IN_OUT = [0.4, 0, 0.2, 1] as const;

/**
 * One transition per token, plus the one spring.
 *
 * `settle` is for a thing that moves to a new place and is still the same
 * thing when it gets there: the active-tab indicator, a chevron turning, a
 * highlight following the current step. A spring reads as weight; a duration
 * reads as a cut. Its numbers are chosen to land in about the panel duration
 * with no visible overshoot.
 */
export const transitions = {
  micro: { duration: DURATION.micro, ease: EASE_OUT },
  panel: { duration: DURATION.panel, ease: EASE_OUT },
  page: { duration: DURATION.page, ease: EASE_OUT },
  narrative: { duration: DURATION.narrative, ease: EASE_IN_OUT },
  settle: { type: "spring", stiffness: 520, damping: 42, mass: 1 },
} as const satisfies Record<string, Transition>;

/* ---------------------------------------------------------------------------
   Presence: how a thing arrives and how it leaves. Spread onto an `m.*`
   element inside an <AnimatePresence>.
   --------------------------------------------------------------------------- */

/**
 * The transition rides inside the targets, not as a prop of its own: Headless
 * UI's DialogPanel has a boolean `transition` of its own, and a preset that
 * carried one could not be spread onto it.
 */
interface Presence {
  initial: TargetAndTransition;
  animate: TargetAndTransition;
  exit: TargetAndTransition;
}

/** A backdrop, a toast body: opacity only. */
export const fade: Presence = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: transitions.panel },
  exit: { opacity: 0, transition: transitions.panel },
};

/** A modal: it grows into place by two percent, and shrinks the same on exit. */
export const scaleIn: Presence = {
  initial: { opacity: 0, scale: 0.98 },
  animate: { opacity: 1, scale: 1, transition: transitions.panel },
  exit: { opacity: 0, scale: 0.98, transition: transitions.panel },
};

/** A row, a toast, a page: rises the CSS `page-in` eight pixels. */
export const rise: Presence = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: transitions.panel },
  exit: { opacity: 0, y: 8, transition: transitions.panel },
};

/**
 * A panel that arrives from an edge and leaves the way it came: the catalog
 * drawer from the left (`-100%`), the detail sheet from the right (`100%`).
 * A string is a percentage of the element's own width, so the sheet need not
 * know how wide it is.
 */
export function slideFrom(x: number | string): Presence {
  return {
    initial: { x },
    animate: { x: 0, transition: transitions.panel },
    exit: { x, transition: transitions.panel },
  };
}

/**
 * A branch that opens: height from nothing to whatever its children need, and
 * back. Overflow is the component's, below: hidden while the height moves,
 * visible once it has landed.
 */
export const unfold: Presence = {
  initial: { height: 0, opacity: 0 },
  animate: { height: "auto", opacity: 1, transition: transitions.panel },
  exit: { height: 0, opacity: 0, transition: transitions.panel },
};

/**
 * `unfold`, as a component: the children are there while `open`, and arrive
 * and leave on the preset. `initial={false}` because a tree restored from the
 * last session must not open every branch on the way in.
 */
export function Unfold({
  open,
  children,
}: {
  open: boolean;
  children: ReactNode;
}) {
  return (
    <AnimatePresence initial={false}>
      {open ? <UnfoldBox>{children}</UnfoldBox> : null}
    </AnimatePresence>
  );
}

/**
 * Overflow is hidden only while the box is moving. Open and at rest it is
 * visible, so the focus ring on the first or last row inside is not clipped
 * by the box that grew to hold it. (`transitionEnd` on the target would say
 * the same, but Motion 13 applies it only to a static render, not after the
 * animation it was meant to end.)
 */
function UnfoldBox({ children }: { children: ReactNode }) {
  const [moving, setMoving] = useState(false);
  return (
    <m.div
      {...unfold}
      style={{ overflow: moving ? "hidden" : "visible" }}
      onAnimationStart={() => setMoving(true)}
      onAnimationComplete={() => setMoving(false)}
    >
      {children}
    </m.div>
  );
}

/* ---------------------------------------------------------------------------
   The provider. Once, at the root.
   --------------------------------------------------------------------------- */

/**
 * The feature bundle arrives after first paint; until then an `m.*` element
 * renders as its plain tag, at its `animate` values. That is the correct
 * first frame anyway: nothing on the first screen leaves or moves.
 */
const loadFeatures = () => import("./motion-features").then((mod) => mod.default);

/**
 * `reducedMotion="user"` makes every `m.*` element read the same media query
 * `useReducedMotion` below reads: transforms and layout stop moving, opacity
 * still crossfades, so a reader who asked for less motion still sees things
 * arrive and leave, just without travelling.
 *
 * `strict` throws on a `motion.*` element under this tree - the full one,
 * with every feature bundled in. Only `m.*` belongs here.
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={loadFeatures} strict>
      <MotionConfig reducedMotion="user" transition={transitions.panel}>
        {children}
      </MotionConfig>
    </LazyMotion>
  );
}

/* ---------------------------------------------------------------------------
   The pieces that predate Motion and stay: a count that ticks up, and the
   media query for code that animates by hand.
   --------------------------------------------------------------------------- */

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
