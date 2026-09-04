import { useLayoutEffect, useRef } from "react";
import type { ReactNode } from "react";
import { ctxStyle } from "../lib/context-color";
import { PinButton } from "../app/pins";
import type { PinKind } from "../lib/pins";
import { AnchorLink } from "./AnchorLink";
import { Ident } from "./Ident";

/**
 * The header strip every entity page opens with. `contextId` paints the hero
 * wash - 120px of that context's colour at 6%, fading to nothing. The header's
 * own content sits above it on solid background, so no text is ever read off
 * a gradient.
 *
 * `pin` puts the pin control at the head of the right-hand group, before
 * whatever else the page puts there. It is first because it is the only
 * control on the strip that is about the reader rather than about the entity,
 * and a reader looking for it should find it in the same place on every page.
 *
 * The strip is sticky inside the page's scroll box (`.page-header`), so it
 * publishes its own height as `--page-header-h` on that box: the toc dock
 * pins itself under it, and the box's scroll-padding keeps an anchor jump
 * from landing behind it. The height is written rather than assumed because a
 * service header carries a meta row and a tab list that an aggregate's does
 * not, and both wrap at narrow widths.
 */
const HEIGHT_VAR = "--page-header-h";

export function PageHeader({
  kind,
  name,
  id,
  contextId,
  pin,
  right,
  children,
}: {
  kind: string;
  name: string;
  id?: string;
  contextId?: string | null;
  /** What pinning this page pins. Omitted on pages that are not pinnable. */
  pin?: { kind: PinKind; id: string };
  right?: ReactNode;
  children?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    const host = el?.parentElement;
    if (!el || !host || typeof ResizeObserver === "undefined") return;
    const publish = () =>
      host.style.setProperty(HEIGHT_VAR, `${el.offsetHeight}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    return () => {
      observer.disconnect();
      host.style.removeProperty(HEIGHT_VAR);
    };
  }, []);

  return (
    <div
      ref={ref}
      className="page-header border-b border-line px-gutter py-5"
    >
      <div aria-hidden className="hero-wash" style={ctxStyle(contextId)} />
      <div className="label">{kind}</div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-md font-semibold" title={name}>
          {name}
        </h1>
        {/* The id under a page's own name is the single most-copied string in
            the app - it is what a reader takes to a grep or a ticket. */}
        {id ? <Ident value={id} className="text-muted" /> : null}
        {pin || right ? (
          <div className="ml-auto flex items-center gap-2">
            {pin ? (
              <PinButton kind={pin.kind} id={pin.id} label={name} />
            ) : null}
            {right}
          </div>
        ) : null}
      </div>
      {children}
    </div>
  );
}

export function SectionTitle({
  children,
  right,
  anchor,
}: {
  children: ReactNode;
  right?: ReactNode;
  /**
   * The id of the section this titles. Every count in this app already links
   * to one of these; passing it here is what lets a reader link back out.
   */
  anchor?: string;
}) {
  return (
    <div className={`mb-3 flex items-center gap-2 ${anchor ? "anchored" : ""}`}>
      <h2 className="section-title">{children}</h2>
      {anchor ? (
        <AnchorLink
          id={anchor}
          {...(typeof children === "string" ? { label: children } : {})}
        />
      ) : null}
      {right ? <div className="section-aside ml-auto">{right}</div> : null}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

/**
 * What a page says before the catalog has anything to put on it.
 *
 * `Empty` answers a question the reader asked - a filter, a lookup - with
 * "nothing". This answers one they have not asked yet: the first catalog off a
 * real repository is one context and a handful of events, and the sections it
 * cannot fill must read as the start of something rather than as a dashboard
 * with its wires cut. So it says where the missing facts come from, and names
 * the file they land in - the one thing a reader can act on today.
 */
export function Blank({
  children,
  where,
}: {
  children: ReactNode;
  /** Path in the repository the absent facts are read from. */
  where?: string;
}) {
  return (
    <div className="empty">
      {/* The box is as wide as the list it stands in for, but a sentence is
          not: capped at prose width and centred, so it does not run the full
          bleed of a wide window. */}
      <div className="mx-auto max-w-prose">{children}</div>
      {where ? (
        <div className="mt-2">
          <Ident value={where} />
        </div>
      ) : null}
    </div>
  );
}
