// One entry of a glossary, as a card: the word, and what it means.
//
// The slug is not drawn. `Bus` and `bus` beside each other is the same word
// printed twice, and the id it would have carried is on the copy button that
// every row in this app has.

import { Fragment } from "react";
import { Link } from "react-router";
import type { Term } from "../catalog";
import { KindIcon } from "../components/kind";
import type { TermTarget } from "../lib/terms";
import { RowActions } from "../components/RowActions";
import { ContextPill } from "../components/primitives";
import { ctxStyle } from "../lib/context-color";
import { sourceHref } from "../lib/source-link";
import { staggerStyle } from "../lib/motion";

/**
 * Backticks, and nothing else.
 *
 * A glossary is prose with the occasional identifier in it - `logout`, the
 * name of a service - and every other mark the format allows is already gone
 * by the time a term reaches the catalog. So this is a split on backticks and
 * not a markdown renderer: one react-markdown per card, thirty-eight of them
 * on a page, to italicise nothing.
 */
function inline(text: string) {
  return text.split("`").map((part, i) =>
    i % 2 === 1 ? (
      <code key={i} className="mono">
        {part}
      </code>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

export function TermCard({
  term,
  targets = [],
  index = 0,
  showContext = false,
}: {
  term: Term;
  /**
   * What the word names in the model, when the two spell it the same way.
   * Empty is the ordinary case for the words worth defining - Bus, Refusal,
   * Conflict name no type - so the row simply does not appear, and nothing on
   * the card says anything is missing.
   */
  targets?: readonly TermTarget[];
  /** Position in the list, for the staggered entrance. */
  index?: number;
  /**
   * Names the context on the card. Off inside a vocabulary, whose heading has
   * already said it; on where cards from several contexts stand together, and
   * there the context is the only thing telling two of them apart.
   */
  showContext?: boolean;
}) {
  const href = sourceHref(term.source, null);

  return (
    <div
      id={`term-${term.id}`}
      /* A column, so the row of cards can be one height and the line under
         the definition still sits on the floor of each of them. Stretched to
         its neighbours and left alone, a short entry grows a pocket of empty
         card under its last sentence. */
      className="card card-static stagger-in flex flex-col scroll-mt-4"
      style={{ ...staggerStyle(index), ...ctxStyle(term.context), borderLeftWidth: 3 }}
    >
      <div className="flex items-baseline gap-2">
        <h3 className="font-semibold">{term.name}</h3>
        {showContext ? (
          <span className="ml-auto shrink-0">
            <ContextPill id={term.context} />
          </span>
        ) : null}
      </div>

      <p className="mt-1.5">{inline(term.definition)}</p>

      {targets.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {targets.map((target) => (
            <Link
              key={target.id}
              to={target.path}
              className="chip hover:border-line-strong hover:text-ink"
              title={`${target.kind} ${target.id}`}
            >
              {/* A state is not one of the app's kinds - it has no page and no
                  mark of its own - so it wears a dot rather than borrowing an
                  icon that would say it was something it is not. */}
              {target.kind === "state" ? (
                <span aria-hidden className="dot" />
              ) : (
                <KindIcon kind={target.kind} />
              )}
              {target.name}
            </Link>
          ))}
        </div>
      ) : null}

      {/* Where the entry was written, and the button that copies its id, on one
          line under the definition. The copy sat in the heading before, which
          put a button between the word and the context that means it - two
          things a reader compares across cards, and a control that appears
          between them on hover is a control that moves them apart. */}
      <div className="mt-auto flex items-baseline gap-2 pt-2 t-micro">
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="mono text-faint hover:text-accent"
          >
            {term.source}
          </a>
        ) : (
          /* Not a link, but still the answer to "where do I change this?" -
             the same way every unlinkable path in this app stays text. */
          <span className="mono text-faint">{term.source}</span>
        )}
        <RowActions copy={term.id} label={term.name} />
      </div>
    </div>
  );
}
