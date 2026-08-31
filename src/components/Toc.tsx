// The right-edge table of contents, with scroll-spy.
//
// It began as the readme outline on the aggregate page and is now the one
// component every long page uses, because two implementations of "where am I"
// is exactly how the two start disagreeing.
//
// It costs 24px of the page, not 208.
//
// At rest it is a column of ticks - one per section, the one you are in lit -
// which is the whole of what a table of contents is for while you are reading:
// how many sections, and which. The names are what you want only when you have
// decided to leave, so they arrive on hover or focus, in a panel that opens
// leftwards OVER the page rather than pushing it. Nothing reflows: the dock
// keeps its 24px whether the panel is open or not.
//
// Spy notes: the observer's root is the page's own scroll container, not the
// window - this shell never scrolls the document - and the bottom margin is
// pulled up to 65% so a section counts as "here" once its heading reaches the
// upper third, which is where a reader actually thinks they are.

import { useEffect, useMemo, useState } from "react";

export interface TocItem {
  /** The id of the element on the page. */
  id: string;
  label: string;
  /** 1 is flush left; each level indents 10px. */
  depth?: number;
}

/** Nearest scrollable ancestor, or null when the page scrolls in the window. */
function scrollParent(el: Element | null): Element | null {
  let node = el?.parentElement ?? null;
  while (node) {
    const overflow = getComputedStyle(node).overflowY;
    if (overflow === "auto" || overflow === "scroll") return node;
    node = node.parentElement;
  }
  return null;
}

export function useScrollSpy(ids: readonly string[]): string | null {
  const [active, setActive] = useState<string | null>(ids[0] ?? null);
  const key = ids.join(" ");

  useEffect(() => {
    const list = key ? key.split(" ") : [];
    const elements = list
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (elements.length === 0) return;

    const seen = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) seen.add(entry.target.id);
          else seen.delete(entry.target.id);
        }
        // First in document order wins, so scrolling down moves the marker
        // down one section at a time rather than jumping to whatever fired.
        const first = list.find((id) => seen.has(id));
        // Nothing intersecting means the reader is between two sections;
        // holding the last answer beats blanking the rail.
        if (first) setActive(first);
      },
      {
        root: scrollParent(elements[0] ?? null),
        rootMargin: "0px 0px -65% 0px",
        threshold: 0,
      },
    );
    for (const el of elements) observer.observe(el);
    return () => observer.disconnect();
  }, [key]);

  return active;
}

export function Toc({
  items,
  label = "On this page",
  title = "On this page",
}: {
  items: readonly TocItem[];
  /** Accessible name for the nav landmark. */
  label?: string;
  /** The heading printed above the list, once the panel is open. */
  title?: string;
}) {
  const ids = useMemo(() => items.map((i) => i.id), [items]);
  const active = useScrollSpy(ids);

  if (items.length === 0) return null;

  return (
    <nav
      /* Hidden below the two-column breakpoint, where the page has no right
         edge to spare at all. */
      className="toc-dock sticky top-0 hidden h-fit shrink-0 self-start lg:block"
      aria-label={label}
    >
      <div className="toc-panel">
        <div className="label toc-name mb-1 px-3 pt-1">{title}</div>
        <ul>
          {items.map((item) => {
            const on = item.id === active;
            return (
              <li key={item.id}>
                <a
                  href={`#${item.id}`}
                  aria-current={on ? "location" : undefined}
                  /* The tick is the marker AND the hairline: 2px, always
                     drawn, transparent when idle, so nothing shifts as the
                     spy moves down the page. */
                  className={`toc-item ${on ? "text-ink" : "text-muted"}`}
                  style={{
                    borderColor: on ? "var(--accent)" : "var(--border)",
                    marginLeft: ((item.depth ?? 1) - 1) * 10,
                  }}
                  title={item.label}
                >
                  <span className="toc-name">{item.label}</span>
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
