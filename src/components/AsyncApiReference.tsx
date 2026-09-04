// The AsyncAPI document itself, rendered.
//
// The same argument the OpenAPI reference makes beside it holds here, and for
// the same reason: the catalog says the service has a document and where it
// lives, the bus tab keeps the facts read out of it - the channels, and which
// way each message travels - and this shows the document those were read from.
// Re-deriving a document's own shape into the schema would be rebuilding
// AsyncAPI inside it.
//
// What it does NOT do is draw the channels. Those are catalog facts by the time
// they reach a page: they link to the event that publishes a message and to the
// service that listens for one, which a rendered document cannot do because it
// has never heard of the estate around it.

import { lazy, Suspense, useEffect, useState } from "react";
import { loaderFor as loaderIn } from "../lib/spec-files";
import { Empty } from "./PageHeader";

/**
 * Loaded on demand. This one is worth more than the OpenAPI reference is: the
 * component brings the AsyncAPI parser with it, which is most of its weight,
 * and a reader who never opens the tab pays none of it.
 */
// The parser inside the component is a Node library that reached the browser
// unchanged - it calls Buffer, util and process while it loads - and the shims
// it needs are named in vite.config.ts.
const Reference = lazy(async () => {
  // The stylesheet is a separate file the bundle does not pull in, so it is
  // imported here rather than at the top: alongside the component it styles,
  // and only when that component is wanted. Everything in it is scoped under
  // `.aui-root`, so it meets the app's own styles nowhere.
  await import("@asyncapi/react-component/styles/default.min.css");
  const { default: AsyncApiComponent } = await import(
    "@asyncapi/react-component"
  );

  return { default: AsyncApiComponent };
});

/**
 * The documents in the repository, by path, loaded on demand. A document that
 * lives in another repository is not here, and that is the normal case: the
 * catalog still lists the channels, and this tab says plainly it has nothing
 * to show.
 */
const SPECS = import.meta.glob<string>(
  ["../../examples/**/asyncapi.yaml", "../../examples/**/asyncapi.yml"],
  { query: "?raw", import: "default" },
);

/** Whether the document a catalog entry points at is one this site can show. */
export function hasAsyncSpec(source: string): boolean {
  return loaderIn(SPECS, source) !== null;
}

export function AsyncApiReference({ source }: { source: string }) {
  const [spec, setSpec] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    const load = loaderIn(SPECS, source);
    if (!load) {
      setMissing(true);

      return;
    }

    let live = true;
    load()
      .then((text) => {
        if (live) setSpec(text);
      })
      .catch(() => {
        if (live) setMissing(true);
      });

    return () => {
      live = false;
    };
  }, [source]);

  if (missing) {
    return (
      <Empty>
        this service&apos;s document is not in this repository — only the
        channels the catalog extracted from it are
      </Empty>
    );
  }

  if (spec === null) return <Empty>reading the document…</Empty>;

  return (
    /* A sheet of paper on a dark desk: the document is drawn light whatever the
       app's theme is, because the component's own stylesheet has no dark mode
       to switch. `.spec-sheet` in index.css is where that is arranged, and why
       it takes re-declaring the palette rather than painting a background. */
    <div className="spec-sheet overflow-x-auto rounded-card border border-line p-2">
      <Suspense fallback={<Empty>loading the reference…</Empty>}>
        <Reference
          schema={spec}
          config={{
            show: {
              // Its sidebar would be a second navigation tree beside the one
              // the app already has, over the same channels.
              sidebar: false,
              errors: true,
            },
          }}
        />
      </Suspense>
    </div>
  );
}
