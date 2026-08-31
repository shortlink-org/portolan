// ⌘K. Everything the catalog names, in one list.
//
// Enter sets the selection first and navigates second, and only when the page
// already on screen cannot show what was picked. Choosing an event while its
// service page is open therefore opens the panel and leaves the reader where
// they were, which is the whole point of holding selection globally.
//
// Rows carry the same kind icons as the sidebar tree, and the same taxonomy
// narrows the list: "e: item" searches events, "vo: money" value objects.

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { catalog } from "../data";
import { paletteItems, search } from "../lib/palette";
import type { PaletteItem } from "../lib/palette";
import { KIND_LABEL, KIND_PREFIXES, canonicalPrefix } from "../lib/kinds";
import type { Kind } from "../lib/kinds";
import { ctxStyle } from "../lib/context-color";
import { KindIcon } from "../components/kind";
import { pageContains, selectionPath } from "../selection/pages";
import { selectionHash } from "../selection/hash";
import { selectionFor } from "../selection/model";
import { useSelectionStore } from "../selection/store";

const ITEMS = paletteItems(catalog);

/** The prefixes offered under an empty input. Kinds, not every spelling. */
const HINT_KINDS: Kind[] = [
  "event",
  "vo",
  "entity",
  "aggregate",
  "command",
  "query",
];

export function CommandPalette({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const navigate = useNavigate();
  const location = useLocation();
  const setSelection = useSelectionStore((s) => s.set);
  const listRef = useRef<HTMLUListElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const result = useMemo(() => search(ITEMS, open ? query : ""), [open, query]);
  const results = open ? result.items : [];

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setCursor(0);
    // Focus after paint so the overlay is mounted and the caret lands.
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => setCursor(0), [query]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-at="${cursor}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [cursor, results]);

  if (!open) return null;

  const commit = (item: PaletteItem): void => {
    onClose();

    if (item.selectId) {
      const selection = selectionFor(item.selectId);

      // This page can already point at it: select in place and move nobody.
      if (pageContains(location.pathname, selection)) {
        setSelection(selection, "palette");
        return;
      }

      // Otherwise carry the selection in the URL rather than writing it to the
      // store first. Two writers - this handler and SelectionSync - would race
      // for the same history entry, and the sync's `replace` would land with
      // the pathname it had before the navigation, undoing it. A selection in
      // the URL wins on arrival, so one write does both jobs.
      const to = selectionPath(selection) ?? item.path;
      if (to) navigate(`${to}${selectionHash(selection)}`);
      else setSelection(selection, "palette");
      return;
    }

    // Rows the selection model does not resolve - value objects, entities,
    // commands, queries, flows, decisions - simply go to their page.
    if (item.path && item.path !== location.pathname) navigate(item.path);
  };

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === "Escape") {
      e.preventDefault();
      // Stopped here so the global handler does not also clear the selection.
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(results.length - 1, c + 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const item = results[cursor];
      if (item) commit(item);
    }
  };

  return (
    <div
      className="overlay-in fixed inset-0 z-50 flex items-start justify-center pt-[12vh]"
      style={{ background: "color-mix(in srgb, #000 45%, transparent)" }}
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="palette-in flex max-h-[70vh] w-[min(680px,92vw)] flex-col overflow-hidden rounded-modal border bg-canvas border-line-strong shadow-md"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        {/* The one accent glow the palette gets: 4%, radial, behind the input. */}
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="jump to anything — or narrow with e: vo: ent: agg: cmd: q:"
          spellCheck={false}
          aria-label="Search the catalog"
          className="glow mono w-full border-b bg-transparent px-4 py-3 text-sm outline-none border-line placeholder:text-muted"
        />

        <div className="mono flex flex-wrap items-center gap-x-2 gap-y-1 border-b px-4 py-2 border-line text-muted">
          {result.kind ? (
            <>
              <span>only</span>
              <span
                className="chip"
                style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
              >
                <KindIcon kind={result.kind} />
                {KIND_LABEL[result.kind]}
              </span>
              {result.term ? <span>matching “{result.term}”</span> : null}
            </>
          ) : (
            <>
              <span>narrow to</span>
              {HINT_KINDS.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => {
                    setQuery(`${canonicalPrefix(kind)}: `);
                    inputRef.current?.focus();
                  }}
                  className="inline-flex items-center gap-1 rounded-control px-0.5 t-micro transition-colors hover:text-ink"
                  title={`${KIND_PREFIXES[kind].join(" / ")} — ${KIND_LABEL[kind]}`}
                >
                  <KindIcon kind={kind} />
                  {canonicalPrefix(kind)}:
                </button>
              ))}
            </>
          )}
        </div>

        {results.length === 0 ? (
          <div className="glow mono px-4 py-8 text-center text-muted">
            no match
          </div>
        ) : (
          <ul ref={listRef} className="min-h-0 flex-1 overflow-y-auto">
            {results.map((item, i) => {
              const active = i === cursor;
              return (
                <li key={item.id} data-at={i}>
                  <button
                    type="button"
                    onMouseMove={() => setCursor(i)}
                    onClick={() => commit(item)}
                    className="flex w-full items-center gap-2 px-4 py-1.5 text-left t-micro transition-colors"
                    style={{
                      background: active ? "var(--surface-2)" : undefined,
                      borderLeft: `2px solid ${active ? "var(--accent)" : "transparent"}`,
                    }}
                  >
                    <span
                      className="flex shrink-0"
                      style={ctxStyle(item.context)}
                    >
                      <KindIcon
                        kind={item.kind}
                        {...(item.context ? { contextId: item.context } : {})}
                      />
                    </span>
                    <span
                      className="mono shrink-0"
                      title={item.name}
                      style={
                        item.kind === "event"
                          ? { color: "var(--kind-event)" }
                          : undefined
                      }
                    >
                      {item.name}
                    </span>
                    <span
                      className="mono truncate text-muted"
                      title={item.detail}
                    >
                      {item.detail}
                    </span>
                    <span className="mono ml-auto flex shrink-0 items-center gap-2 text-muted">
                      {item.badge ? (
                        <span className="rounded-[4px] border px-1 border-line">
                          {item.badge}
                        </span>
                      ) : null}
                      <span className="label">{KIND_LABEL[item.kind]}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="mono flex items-center gap-3 border-t px-4 py-2 border-line text-muted">
          <span>↑↓ move</span>
          <span>⏎ select</span>
          <span>esc close</span>
          <span className="ml-auto">
            {results.length} shown
            {result.truncated > 0 ? ` · +${result.truncated} more` : ""}
          </span>
        </div>
      </div>
    </div>
  );
}
