// ⌘K. Everything the catalog names, in one list.
//
// Enter sets the selection first and navigates second, and only when the page
// already on screen cannot show what was picked. Choosing an event while its
// service page is open therefore opens the panel and leaves the reader where
// they were, which is the whole point of holding selection globally.
//
// Rows carry the same kind icons as the sidebar tree, and the same taxonomy
// narrows the list: "e: item" searches events, "vo: money" value objects.

import { useMemo, useRef, useState } from "react";
import {
  Combobox,
  ComboboxInput,
  ComboboxOption,
  ComboboxOptions,
} from "@headlessui/react";
import { useLocation, useNavigate } from "react-router";
import { Modal } from "../components/Overlay";
import { catalog } from "../data";
import { paletteItems, search } from "../lib/palette";
import type { PaletteHit, PaletteItem } from "../lib/palette";
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
  // Only so a hint chip can hand the caret back after filling the prefix in.
  const inputRef = useRef<HTMLInputElement | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const setSelection = useSelectionStore((s) => s.set);

  const result = useMemo(() => search(ITEMS, open ? query : ""), [open, query]);
  const results = open ? result.hits : [];

  const close = (): void => {
    onClose();
    // Cleared on the way out rather than on the way in: the palette unmounts,
    // and a query left behind would flash under the next ⌘K before the effect
    // that cleared it ran.
    setQuery("");
  };

  const commit = (item: PaletteItem): void => {
    close();

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

  return (
    <Modal open={open} onClose={close} label="Command palette">
      {/* The combobox owns the list: which row is active, keeping it in view,
          ↑↓ and ⏎, and the aria wiring that makes the input announce the row
          under it. Escape is caught on the way DOWN, before the combobox can
          take it - inside a modal there is nothing to close but the modal, and
          a first Escape that only closes an invisible listbox reads as an
          Escape that did nothing. */}
      <div
        className="flex min-h-0 flex-col"
        onKeyDownCapture={(e) => {
          if (e.key !== "Escape") return;
          e.preventDefault();
          e.stopPropagation();
          close();
        }}
      >
        <Combobox<PaletteHit | null>
          value={null}
          onChange={(hit) => {
            if (hit) commit(hit.item);
          }}
          immediate
        >
          {/* The one accent glow the palette gets: 4%, radial, behind the input. */}
          <ComboboxInput
            ref={inputRef}
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="jump to anything — or narrow with e: vo: ent: agg: cmd: q:"
            spellCheck={false}
            aria-label="Search the catalog"
            className="glow mono w-full shrink-0 border-b bg-transparent px-4 py-3 text-sm outline-none border-line placeholder:text-muted"
          />

          <div className="mono flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b px-4 py-2 border-line text-muted">
            {result.kind ? (
              <>
                <span>only</span>
                <span
                  className="chip"
                  style={{
                    borderColor: "var(--accent)",
                    color: "var(--accent)",
                  }}
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
            /* `static` because the list is the palette: there is no closed
               state to render, and the modal around it is what "closed" means
               here. */
            <ComboboxOptions static className="min-h-0 flex-1 overflow-y-auto">
              {results.map(({ item, excerpt }) => (
                <ComboboxOption
                  key={item.id}
                  value={{ item, ...(excerpt ? { excerpt } : {}) }}
                  /* The 2px edge is always drawn and only changes colour, so
                     the row under the cursor never nudges the text beside it. */
                  className={({ focus }) =>
                    `flex w-full cursor-pointer flex-col gap-0.5 border-l-2 px-4 py-1.5 text-left t-micro transition-colors ${
                      focus ? "bg-raised border-accent" : "border-transparent"
                    }`
                  }
                >
                  {() => (
                    <>
                      <span className="flex w-full items-center gap-2">
                        <span
                          className="flex shrink-0"
                          style={ctxStyle(item.context)}
                        >
                          <KindIcon
                            kind={item.kind}
                            {...(item.context
                              ? { contextId: item.context }
                              : {})}
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
                      </span>
                      {/* Why this row is here. Sans, not mono: the line above
                          is identifiers, this one is a sentence, and the two
                          must not be mistaken for each other. */}
                      {excerpt ? (
                        <span className="w-full truncate pl-6 text-xs text-muted">
                          {excerpt.before}
                          <span style={{ color: "var(--accent)" }}>
                            {excerpt.match}
                          </span>
                          {excerpt.after}
                        </span>
                      ) : null}
                    </>
                  )}
                </ComboboxOption>
              ))}
            </ComboboxOptions>
          )}
        </Combobox>

        <div className="mono flex shrink-0 items-center gap-3 border-t px-4 py-2 border-line text-muted">
          <span>↑↓ move</span>
          <span>⏎ select</span>
          <span>esc close</span>
          <span className="ml-auto">
            {results.length} shown
            {result.truncated > 0 ? ` · +${result.truncated} more` : ""}
          </span>
        </div>
      </div>
    </Modal>
  );
}
