// What the reader sees when data/catalog.json cannot be trusted.
//
// This page exists because the alternative is worse in a specific way: a
// validator that throws at import time takes the bundle down, and the reader
// gets a white rectangle while the only useful sentence in the building sits in
// a console nobody has open. So the message is printed verbatim - it already
// names the offending flow, step or field - along with where to look and what
// to do about it.

import type { CatalogError } from "../catalog";
import { Ident } from "../components/Ident";
import { CompassRose } from "../components/logo";

/**
 * What to do about it, matched on the message the validator wrote. The
 * fallback is the honest one: something upstream produced a catalog that does
 * not describe a consistent estate, and the fix is in the generator, not here.
 */
const HINTS: { test: RegExp; hint: string }[] = [
  {
    test: /references unknown def/,
    hint: "The named shape is not in `catalog.defs`. Either the generator dropped the definition, or the ref is a typo — check the proto or the source file the field was read from.",
  },
  {
    test: /is not a declared participant/,
    hint: "A step names a lane the flow never declared. Add the service to the flow's `participants`, or point the step at one that is already there.",
  },
  {
    test: /resolves to neither an Event nor an RpcCall/,
    hint: "Either the ref is stale — the event was renamed or removed — or the step really does point at something outside the catalog, in which case its status belongs as `unresolved`.",
  },
  {
    test: /must have id/,
    hint: "Ids are composed, not free text: a service is `<context>.<slug>`, a block is `<aggregate>.<slug>`. The generator built one of them from the wrong parts.",
  },
  {
    test: /is not unique/,
    hint: "Two things claim the same slug or id. Slugs are what the URLs are built from, so one of them would be unreachable.",
  },
  {
    test: /alt|loop|branch|terminal/,
    hint: "A frame that does not state a choice is drawn as an ordinary sequence, which is the misreading the validator exists to stop. Give the frame its title, its second branch, or move the steps that follow it.",
  },
  {
    test: /names root|names no root/,
    hint: "An aggregate is a root entity plus what it owns. The root has to be one of the entities the aggregate lists.",
  },
  {
    test: /adr/,
    hint: "A decision record points at something that is not in the catalog, or records only half of a supersession. Both would draw a link to nowhere.",
  },
];

function hintFor(message: string): string {
  return (
    HINTS.find((h) => h.test.test(message))?.hint ??
    "The catalog does not describe a consistent estate. Fix the source the generator read, then re-run it — nothing here can be drawn until the shape holds."
  );
}

export function CatalogFailure({ error }: { error: CatalogError }) {
  return (
    <div className="pane h-full overflow-y-auto bg-canvas">
      <div className="mx-auto max-w-prose px-gutter py-16">
        <div className="flex items-center gap-2 text-muted">
          <CompassRose size={16} />
          <span className="label">portolan</span>
        </div>

        <h1 className="mt-6 text-xl font-semibold">
          The catalog did not survive validation.
        </h1>
        <p className="mt-3 text-muted">
          Nothing is drawn from a catalog that has already been shown to be
          wrong — a chart with one bad sounding on it is worse than no chart.
          Here is the sounding.
        </p>

        <div className="mt-section overflow-hidden rounded-card border shadow-xs border-unresolved">
          <div className="label border-b px-4 py-2 border-line bg-surface">
            validator
          </div>
          {/* Verbatim, wrapped, selectable: this string is the thing to paste
              into the generator's issue, so it is not summarised or truncated. */}
          <pre className="mono overflow-x-auto px-4 py-3 whitespace-pre-wrap text-unresolved">
            {error.message}
          </pre>
          {error.path ? (
            <div className="flex flex-wrap items-baseline gap-2 border-t px-4 py-3 border-line">
              <span className="label">where</span>
              <Ident value={error.path} className="text-ink" />
            </div>
          ) : null}
        </div>

        <div className="mt-grid rounded-card border p-card border-line">
          <div className="label mb-2">how to fix</div>
          <p>{hintFor(error.message)}</p>
          <p className="mt-3 text-muted">Then regenerate and reload:</p>
          <pre className="mono mt-2 overflow-x-auto rounded-control border px-3 py-2 border-line bg-surface">
            npm run likec4:gen
          </pre>
        </div>

        <p className="mono mt-section text-muted">
          data/catalog.json — validated by src/catalog.ts
        </p>
      </div>
    </div>
  );
}
