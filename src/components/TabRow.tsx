import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Tab } from "@headlessui/react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { LayoutGroup, m, transitions } from "../lib/motion";

/**
 * The strip a page's tab list scrolls inside.
 *
 * Eight tabs are wider than a phone and wider than a laptop with something
 * beside it, and a plain flex row answers that by cutting the last of them off
 * mid-word - which reads as a rendering fault, not as a row that continues.
 * So the row scrolls, and says so: a fade at whichever edge still has tabs
 * behind it, and a chevron on the fade for a reader who has no trackpad to
 * flick with. Both edges are tested independently, because the row can be
 * scrolled to the middle and be cut off at both ends at once.
 *
 * The fades are drawn in the header's own background, so the tabs pass under
 * them rather than into a band of some other colour; they take no pointer
 * events, and the chevrons on top of them take theirs back.
 */
export function TabRow({
  active,
  children,
}: {
  /** The selected tab. Changing it scrolls that tab back into view. */
  active?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Namespaces the bar's layoutId to this strip, for a screen with two.
  const group = useId();
  const [edges, setEdges] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // Sub-pixel layout leaves a fraction of overflow on a row that is not
    // actually cut off, and a fade over nothing is a lie about the row. One
    // pixel of slack at each end is what keeps the affordance honest.
    const max = el.scrollWidth - el.clientWidth;
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft < max - 1;
    setEdges((was) =>
      was.left === left && was.right === right ? was : { left, right },
    );
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    if (typeof ResizeObserver === "undefined") return;
    // The strip's own width says how much room there is; the list inside it
    // says how much is wanted, and that changes when the counts arrive.
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => observer.disconnect();
  }, [measure]);

  // A tab picked from the url can start life off the end of the strip, and a
  // reader who cannot see the selected tab cannot tell which page they are on.
  useEffect(() => {
    const selected = ref.current?.querySelector('[aria-selected="true"]');
    selected?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);

  const nudge = (direction: -1 | 1) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({
      left: direction * Math.max(120, el.clientWidth * 0.6),
      behavior: "smooth",
    });
  };

  return (
    <LayoutGroup id={group}>
      <div className="relative">
        {/* `layoutScroll`: the bar under the selected tab measures its trip
            through this box, and the box scrolls the new tab into view in the
            same breath. Without it the bar would start its slide from where
            the old tab was before the scroll. */}
        <m.div
          ref={ref}
          layoutScroll
          onScroll={measure}
          className="tab-scroll overflow-x-auto overscroll-x-contain"
        >
          {children}
        </m.div>
        <Edge side="left" show={edges.left} onClick={() => nudge(-1)} />
        <Edge side="right" show={edges.right} onClick={() => nudge(1)} />
      </div>
    </LayoutGroup>
  );
}

function Edge({
  side,
  show,
  onClick,
}: {
  side: "left" | "right";
  show: boolean;
  onClick: () => void;
}) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-y-0 flex items-center transition-opacity ${
        side === "left"
          ? "left-0 justify-start bg-gradient-to-r"
          : "right-0 justify-end bg-gradient-to-l"
      } w-12 from-canvas to-transparent ${show ? "opacity-100" : "opacity-0"}`}
    >
      {/* Not a tab stop: everything behind the fade is reachable by tabbing
          through the tabs themselves, which scrolls the strip on its own. The
          chevron is for the pointer that has no wheel to spin sideways. */}
      <button
        type="button"
        tabIndex={-1}
        onClick={onClick}
        disabled={!show}
        className={`pointer-events-auto flex size-6 items-center justify-center rounded-control text-muted transition-colors hover:bg-surface hover:text-ink ${
          show ? "" : "invisible"
        }`}
      >
        <Icon size={14} />
      </button>
    </div>
  );
}

/**
 * The count beside a tab's name. A bare number ran straight into the label -
 * "provides 6" read as one token at a glance - so it gets a box of its own:
 * the same hairline the rest of the chrome is drawn in, tight enough that the
 * tab does not grow a second word.
 */
export function TabCount({ children }: { children: ReactNode }) {
  return (
    <span className="tnum ml-1.5 rounded-[4px] border px-1 border-line text-muted">
      {children}
    </span>
  );
}

/**
 * A tab. The same on every page that has tabs, and the strip's one moving
 * part: the accent bar under the selected tab is a single element that slides
 * from the old tab to the new, not a border each tab paints for itself. Every
 * tab keeps a transparent 2px border so the bar has a slot to sit in and
 * selecting one never nudges the text.
 */
export function TabButton({ children }: { children: ReactNode }) {
  return (
    <Tab
      className={({ selected }) =>
        `mono relative shrink-0 rounded-t-control border-b-2 border-transparent px-3 py-1.5 t-micro transition-colors focus:outline-none ${
          selected ? "text-ink" : "text-muted hover:text-ink"
        }`
      }
    >
      {({ selected }) => (
        <>
          {children}
          {selected ? (
            <m.span
              layoutId="tab-bar"
              aria-hidden
              className="pointer-events-none absolute inset-x-0 -bottom-0.5 h-0.5 bg-accent"
              transition={transitions.settle}
            />
          ) : null}
        </>
      )}
    </Tab>
  );
}
