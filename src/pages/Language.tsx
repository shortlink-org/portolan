// The estate's vocabulary, every glossary in one place.
//
// Cards rather than a table, and that is not a style choice: a term is two
// sentences, and two sentences in a cell are a cell nobody reads. The decisions
// index is a table because its rows differ by status, date and scope - things
// you scan down a column. Entries differ only by what they say.
//
// The homonyms come first when there are any. A vocabulary is something each
// context already keeps for itself; the same word meaning two things in two
// contexts is the one fact no single glossary can state, and it is what a
// reader crossing a boundary gets wrong.

import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { CATALOG_PATH, catalog, index } from "../data";
import { allTerms } from "../catalog";
import { Blank, Empty, SectionTitle } from "../components/PageHeader";
import { ContextPill } from "../components/primitives";
import { contextVar } from "../lib/context-color";
import { plural } from "../lib/format";
import { paths } from "../routes";
import { TermCard } from "../language/TermCard";
import { homonyms, matchTerms, vocabularies } from "../language/cards";

export function Language() {
  // `?context=` is how the sidebar arrives here: the reader clicked one
  // vocabulary, so the page opens showing it. It seeds the chips rather than
  // replacing them - once here, the filter is theirs to widen.
  const [params] = useSearchParams();
  const [active, setActive] = useState<Set<string>>(
    () =>
      new Set(
        params
          .getAll("context")
          .filter((id) => catalog.contexts.some((c) => c.id === id)),
      ),
  );
  const [query, setQuery] = useState("");

  // One word, asked for by ⌘K or by a link. It overrides both filters rather
  // than combining with them: a reader who picked a word is owed that word,
  // not "no term matches" because a chip they set a minute ago excluded it.
  const focused = index.termById.get(params.get("term") ?? "");

  const all = useMemo(() => vocabularies(catalog), []);
  const shared = useMemo(() => homonyms(catalog), []);
  const total = allTerms(catalog).length;

  const shown = useMemo(
    () =>
      all
        .filter((v) => active.size === 0 || active.has(v.contextId))
        .map((v) => ({ ...v, terms: matchTerms(v.terms, query) }))
        .filter((v) => v.terms.length > 0),
    [all, active, query],
  );
  const showing = shown.reduce((n, v) => n + v.terms.length, 0);

  const toggle = (id: string) =>
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (total === 0) {
    return (
      <div className="h-full overflow-y-auto p-gutter">
        <h1 className="text-lg font-semibold">Language</h1>
        <div className="mt-section">
          <Blank where={CATALOG_PATH}>
            No glossary yet — one file per bounded context, beside its README,
            saying what each word means inside the boundary and what it does
            not. They are read from every <span className="text-ink">GLOSSARY.md</span>{" "}
            the manifest points at and land in{" "}
            <span className="text-ink">terms[]</span>.
          </Blank>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-gutter">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold">Language</h1>
        <span className="mono text-muted">
          {showing === total
            ? `${total} ${plural(total, "term")}`
            : `${showing} of ${total}`}
        </span>

        {/* Both filters stand down while one word is asked for: they would be
            controls that change nothing, and the way back is the link beside
            the card. */}
        {focused ? null : (
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="a word, or something it says"
            aria-label="Filter terms"
            spellCheck={false}
            className="mono w-56 rounded-control border bg-transparent px-2 py-1 outline-none border-line placeholder:text-faint focus:border-accent"
          />
        )}

        {!focused && all.length > 1 ? (
          <div className="seg ml-auto" role="group" aria-label="Filter by context">
            {all.map((v) => {
              const on = active.has(v.contextId);
              return (
                <button
                  key={v.contextId}
                  type="button"
                  onClick={() => toggle(v.contextId)}
                  aria-pressed={on}
                  className="flex items-center gap-1.5"
                  style={{
                    color: on ? contextVar(v.contextId) : "var(--fg-muted)",
                    background: on
                      ? `color-mix(in srgb, ${contextVar(v.contextId)} 12%, transparent)`
                      : undefined,
                  }}
                >
                  <span
                    aria-hidden
                    className="size-1.5 rounded-[1px]"
                    style={{ background: contextVar(v.contextId) }}
                  />
                  {v.contextId}
                  <span className="tnum">{v.terms.length}</span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      {focused ? (
        <div className="mt-section">
          <SectionTitle
            right={
              <Link to={paths.language()} className="text-accent">
                show all {total} →
              </Link>
            }
          >
            <span className="flex items-center gap-2">
              one word
              <ContextPill id={focused.context} />
            </span>
          </SectionTitle>
          <div className="grid gap-grid grid-cols-[repeat(auto-fill,minmax(340px,1fr))]">
            <TermCard term={focused} />
          </div>
        </div>
      ) : null}

      {/* Only while the reader is looking at everything. Narrowed to one
          context, "the same word, twice" is a comparison with one side of it
          hidden, which is worse than not drawing it. */}
      {!focused && shared.length > 0 && active.size === 0 && query === "" ? (
        <div className="mt-section">
          <SectionTitle
            anchor="homonyms"
            right={
              <span>
                two meanings, both correct — each belongs to its own boundary
              </span>
            }
          >
            The same word, twice
          </SectionTitle>
          <div className="flex flex-col gap-grid">
            {shared.map((homonym) => (
              <div
                key={homonym.slug}
                className="grid gap-grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))]"
              >
                {homonym.terms.map((term, i) => (
                  <TermCard key={term.id} term={term} index={i} showContext />
                ))}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {focused ? null : shown.length === 0 ? (
        <div className="mt-section">
          <Empty>no term matches</Empty>
        </div>
      ) : (
        shown.map((vocabulary) => (
          <div key={vocabulary.contextId} className="mt-section">
            <SectionTitle
              anchor={`ctx-${vocabulary.contextId}`}
              right={
                <span className="mono">
                  {vocabulary.terms.length}{" "}
                  {plural(vocabulary.terms.length, "term")}
                </span>
              }
            >
              <span className="flex items-center gap-2">
                {vocabulary.context ? (
                  <Link to={paths.context(vocabulary.contextId)}>
                    <ContextPill
                      id={vocabulary.contextId}
                      name={vocabulary.context.name}
                    />
                  </Link>
                ) : (
                  <ContextPill id={vocabulary.contextId} />
                )}
              </span>
            </SectionTitle>
            {/* What the context is, in its own words, above the words it
                uses. A context that has not said renders nothing rather than a
                placeholder - the same silence every other page keeps about a
                fact the estate has not stated. */}
            {vocabulary.context?.summary ? (
              <p className="mb-3 max-w-prose text-muted">
                {vocabulary.context.summary}
              </p>
            ) : null}
            <div
              className="grid gap-grid grid-cols-[repeat(auto-fill,minmax(340px,1fr))]"
              data-nav-list
            >
              {vocabulary.terms.map((term, i) => (
                <TermCard key={term.id} term={term} index={i} />
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
