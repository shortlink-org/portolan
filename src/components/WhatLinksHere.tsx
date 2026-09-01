// The incoming half of the graph, drawn the same way on every entity page.
//
// A page's own body says what a thing depends on. This says what depends on
// it — the question a reader actually arrives with, and the one no single
// entity can answer about itself. It sits last on every page and answers under
// the same heading, at the same anchor, in the same row shape, so "who breaks
// if I change this" is one place to look rather than five different ones.
//
// Every row says WHY it is here. A name with no reason attached would send the
// reader to open the page just to find out, which is the trip this section
// exists to save.

import { useMemo } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { catalog, index } from "../data";
import { backlinkCount, backlinksFor } from "../lib/backlinks";
import type { Backlink, BacklinkGroup, BacklinkTarget } from "../lib/backlinks";
import { plural } from "../lib/format";
import { KIND_LABEL, KIND_PLURAL } from "../lib/kinds";
import type { Kind } from "../lib/kinds";
import { LINKS_HERE, backlinkPath } from "../routes";
import { KIND_COLOR, KindIcon } from "./kind";
import { Empty, SectionTitle } from "./PageHeader";
import { RowActions } from "./RowActions";
import { StatusChip } from "./primitives";

/** A section on this same page that already lists one kind of link, in full. */
export interface Elsewhere {
  /** Where it is: a fragment, or a tab's query string. */
  href: string;
  /** What it is called there, so the pointer names the thing it points at. */
  label: string;
}

/** Kinds the tree draws a row for, and so the ones "reveal" can find. */
const REVEALABLE: readonly Kind[] = [
  "context",
  "service",
  "aggregate",
  "event",
] as const;

/**
 * The same answer this section draws, for a page that also wants to count it
 * in its header. Derived twice rather than threaded through props, because it
 * is a pure walk over a catalog that does not change while the page is open.
 */
export function useBacklinks(target: BacklinkTarget): BacklinkGroup[] {
  return useMemo(
    () => backlinksFor(catalog, index, target),
    [target.kind, target.id],
  );
}

function Row({ link }: { link: Backlink }) {
  const to = backlinkPath(link);
  // What a reader takes to a grep: the flow's slug is not enough to find the
  // step inside it, so a link that points through one carries both.
  const id = link.at ? `${link.id}/${link.at}` : link.id;
  const reveal = to && REVEALABLE.includes(link.kind) ? link.id : undefined;
  return (
    /* A div holding a link, not a link holding buttons: the row actions are
       interactive too, and interactive content does not nest. */
    <div className="row gap-2">
      <KindIcon kind={link.kind} contextId={link.context ?? undefined} />
      {to ? (
        /* Only events are painted by kind. Everything else keeps the ink of a
           link in a row, because eight muted names in a column would read as
           eight pieces of text rather than eight places to go. */
        <Link
          to={to}
          data-nav-item
          className="mono shrink-0 rounded-control"
          style={
            link.kind === "event" ? { color: KIND_COLOR.event } : undefined
          }
          title={id}
        >
          {link.name}
        </Link>
      ) : (
        <span
          className={`mono shrink-0 ${
            link.status === "unresolved" ? "text-unresolved" : "text-muted"
          }`}
          title={id}
        >
          {link.name}
        </span>
      )}
      {/* One cell per column, empty ones included: the rows share a subgrid,
          and a row that skips a field would slide every field after it into
          the wrong column. */}
      {link.owner ? (
        <span className="min-w-0 truncate text-muted" title={link.owner}>
          {link.owner}
        </span>
      ) : (
        <span />
      )}
      <span className="mono shrink-0 text-muted" title="how it points here">
        {link.via}
      </span>
      {link.versions && link.versions.length > 0 ? (
        <span
          className="mono justify-self-start rounded-[4px] border px-1 border-line text-muted"
          title="event versions carrying it"
        >
          {link.versions.join(" ")}
        </span>
      ) : (
        <span />
      )}
      {link.status ? <StatusChip status={link.status} /> : <span />}
      <RowActions copy={id} {...(reveal ? { reveal } : {})} label={link.name} />
    </div>
  );
}

export function WhatLinksHere({
  target,
  variant = "section",
  elsewhere,
  empty,
}: {
  target: BacklinkTarget;
  /**
   * `section` is the block every scrolling page ends with. `line` is the same
   * facts as one row of chips, for a page with no bottom to put a section on -
   * the flow, whose rail and canvas take the whole height.
   */
  variant?: "section" | "line";
  /**
   * Kinds this page already lists in a section of their own, mapped to where
   * that section is. Those rows are not repeated here; the count and a pointer
   * to them are, so the whole answer is still readable in one place.
   */
  elsewhere?: Partial<Record<Kind, Elsewhere>>;
  /** What to say when nothing points here, when the reason is worth saying. */
  empty?: ReactNode;
}) {
  const groups = useBacklinks(target);

  const total = backlinkCount(groups);
  const shown = groups.filter((g) => !elsewhere?.[g.kind]);
  const pointers = groups
    .map((g) => ({ group: g, at: elsewhere?.[g.kind] }))
    .filter((p): p is { group: (typeof groups)[number]; at: Elsewhere } =>
      Boolean(p.at),
    );

  if (variant === "line") {
    // Nothing to say, so nothing is said: a hero row is not the place for an
    // empty state, and "linked from —" is worse than silence.
    if (total === 0) return null;
    return (
      <span className="mono mt-2 flex flex-wrap items-center gap-1.5 text-muted">
        linked from
        {groups
          .flatMap((g) => g.links)
          .map((link) => {
            const to = backlinkPath(link);
            const body = (
              <>
                <KindIcon
                  kind={link.kind}
                  contextId={link.context ?? undefined}
                />
                {link.name}
              </>
            );
            const title = `${link.owner ?? link.id} — ${link.via}`;
            return to ? (
              <Link
                key={`${link.kind}:${link.id}:${link.name}`}
                to={to}
                className="chip border-line-strong hover:text-ink"
                title={title}
              >
                {body}
              </Link>
            ) : (
              <span
                key={`${link.kind}:${link.id}:${link.name}`}
                className="chip border-line"
                title={title}
              >
                {body}
              </span>
            );
          })}
      </span>
    );
  }

  return (
    <section id={LINKS_HERE} className="mt-section max-w-table">
      <SectionTitle
        anchor={LINKS_HERE}
        right={
          <span>
            <span className="tnum">{total}</span> incoming
          </span>
        }
      >
        What links here
      </SectionTitle>

      {total === 0 ? (
        <Empty>{empty ?? "nothing in the catalog points here"}</Empty>
      ) : null}

      {shown.map((group) => (
        <div key={group.kind} className="mt-3 first:mt-0">
          <div className="label mb-1.5">
            {KIND_PLURAL[group.kind]}{" "}
            <span className="tnum">{group.links.length}</span>
          </div>
          {/* icon, name, owner, why it points here, the versions carrying
              it, status, actions. The owner takes the slack, so the reason
              and everything after it hold the same column down the group. */}
          <div
            className="rows grid-cols-[auto_auto_1fr_auto_auto_auto_auto]"
            data-nav-list
          >
            {group.links.map((link, i) => (
              <Row
                key={`${link.kind}:${link.id}:${link.at ?? i}`}
                link={link}
              />
            ))}
          </div>
        </div>
      ))}

      {pointers.map(({ group, at }) => {
        const body = (
          <>
            <KindIcon kind={group.kind} />
            <span className="tnum">{group.links.length}</span>
            {plural(
              group.links.length,
              KIND_LABEL[group.kind],
              KIND_PLURAL[group.kind],
            )}
            <span className="ml-auto">listed under {at.label}</span>
          </>
        );
        const className = "row mono mt-3 gap-2 text-muted hover:text-ink";
        // A section on this page is a fragment and the browser can jump to it
        // on its own; a tab is a route, and routing it through <a> would
        // reload the whole app to change one panel.
        return at.href.startsWith("#") ? (
          <a key={group.kind} href={at.href} className={className}>
            {body}
          </a>
        ) : (
          <Link key={group.kind} to={at.href} className={className}>
            {body}
          </Link>
        );
      })}
    </section>
  );
}
