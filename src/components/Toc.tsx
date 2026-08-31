// The right-edge table of contents, with scroll-spy.
//
// It began as the readme outline on the aggregate page and is now the one
// component every long page uses, because two implementations of "where am I"
// is exactly how the two start disagreeing.
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
  /** The heading printed above the list. */
  title?: string;
}) {
  const ids = useMemo(() => items.map((i) => i.id), [items]);
  const active = useScrollSpy(ids);

  if (items.length === 0) return null;

  return (
    <nav
      /* Pinned beside the page it indexes, translucent so the content
         scrolling past it stays visible. Hidden below the two-column
         breakpoint, where the page has no right edge to spare. */
      className="sticky-bar sticky top-0 hidden h-fit w-52 shrink-0 self-start border-l lg:block border-line"
      aria-label={label}
    >
      <div className="label mb-2 pl-4">{title}</div>
      <ul>
        {items.map((item) => {
          const on = item.id === active;
          return (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                aria-current={on ? "location" : undefined}
                /* The marker lights the rail the TOC is already drawing: a 2px
                   rule laid over the nav's own hairline, always present and
                   transparent when idle, so nothing shifts as it moves. */
                className={`block truncate border-l-2 py-0.5 pl-4 t-micro transition-colors hover:underline ${
                  on ? "text-ink" : "text-muted"
                }`}
                style={{
                  borderColor: on ? "var(--accent)" : "transparent",
                  /* -1 laps the nav's own hairline, so the lit rule replaces
                     it rather than sitting beside it. */
                  marginLeft: -1 + ((item.depth ?? 1) - 1) * 10,
                }}
              >
                {item.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
