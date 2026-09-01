// The OpenAPI document itself, rendered.
//
// This is the one place in portolan that draws something the catalog did not
// give it. Everywhere else the rule holds - the catalog is the input, the site
// is the output - and it holds here too in the sense that matters: the catalog
// is what says this service has a document and where it lives. What the
// catalog cannot carry is the document's own shape, endpoint by endpoint, and
// re-deriving that into the schema would be rebuilding OpenAPI inside it.
//
// So the provides tab keeps the extracted facts - the ones that are searchable,
// linkable and comparable with a proto service next door - and this tab shows
// the source document beside them.

import { lazy, Suspense, useEffect, useState } from "react";
import { useTheme } from "../app/theme";
import { Empty } from "./PageHeader";

/**
 * Loaded on demand, so a reader who never opens this tab never waits for it and
 * the reference does not sit in the chunk the app boots from.
 */
const Reference = lazy(async () => {
  // The stylesheet is a separate export and the bundle does not pull it in, so
  // it is imported here rather than at the top of the file: alongside the
  // component it styles, and only when that component is actually wanted.
  await import("@scalar/api-reference-react/style.css");
  const { ApiReferenceReact } = await import("@scalar/api-reference-react");

  return { default: ApiReferenceReact };
});

/**
 * The documents in the repository, by path, loaded on demand.
 *
 * A spec that lives in another repository is not here, and that is the normal
 * case for a real estate: the catalog still lists what the service answers,
 * and this tab says plainly that it has nothing to show.
 */
const SPECS = import.meta.glob<string>(
  ["../../examples/**/openapi.yaml", "../../examples/**/openapi.yml"],
  { query: "?raw", import: "default" },
);

function loaderFor(source: string): (() => Promise<string>) | null {
  for (const [path, load] of Object.entries(SPECS)) {
    if (path.replace(/^(\.\.\/)+/, "") === source) return load;
  }

  return null;
}

/** Whether the document a catalog entry points at is one this site can show. */
export function hasSpec(source: string): boolean {
  return loaderFor(source) !== null;
}

export function ApiReference({ source }: { source: string }) {
  const { theme } = useTheme();
  const [spec, setSpec] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    const load = loaderFor(source);
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
        this service&apos;s document is not in this repository — only what the
        catalog extracted from it is
      </Empty>
    );
  }

  if (spec === null) return <Empty>reading the document…</Empty>;

  return (
    <div className="rounded-card border border-line">
      <Suspense fallback={<Empty>loading the reference…</Empty>}>
        <Reference
          configuration={{
            content: spec,
            // Its sidebar would be a second navigation tree beside the one the
            // app already has, listing the same endpoints.
            showSidebar: false,
            forceDarkModeState: theme,
          }}
        />
      </Suspense>
    </div>
  );
}
