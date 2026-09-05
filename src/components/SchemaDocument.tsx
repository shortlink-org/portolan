// The GraphQL schema itself, as it is written.
//
// The rule the OpenAPI reference beside it states - draw the document, because
// the catalog cannot carry the document's own shape - is not quite the reason
// here. `extract-graphql` does read the shape: the provides tab lists every
// field with what it takes and what it answers, linked and searchable, and a
// second copy of that would be worth nothing.
//
// What the SDL carries that the catalog does not is that it is the artifact
// itself. A client author is given this text and writes queries against it,
// and a proto's reader has a module page to go to for the same thing while a
// schema has nowhere else to be. So it is shown as written - no rendering, no
// second navigation tree - and the facts stay next door.

import { useEffect, useState } from "react";
import { loaderFor as loaderIn } from "../lib/spec-files";
import { Empty } from "./PageHeader";

/**
 * The schemas in the repository, by path, loaded on demand. A schema that
 * lives in another repository is not here, which is the normal case: the
 * catalog still lists what the service answers, and this tab says plainly that
 * it has nothing to show.
 */
const SCHEMAS = import.meta.glob<string>(
  ["../../examples/**/*.graphql", "../../examples/**/*.graphqls"],
  { query: "?raw", import: "default" },
);

/** Whether the schema a catalog entry points at is one this site can show. */
export function hasSchema(source: string): boolean {
  return loaderIn(SCHEMAS, source) !== null;
}

export function SchemaDocument({ source }: { source: string }) {
  const [schema, setSchema] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    const load = loaderIn(SCHEMAS, source);
    if (!load) {
      setMissing(true);

      return;
    }

    let live = true;
    load()
      .then((text) => {
        if (live) setSchema(text);
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
        this service&apos;s schema is not in this repository — only the fields
        the catalog extracted from it are
      </Empty>
    );
  }

  if (schema === null) return <Empty>reading the schema…</Empty>;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-muted text-sm">
        The module as it is written, at <code className="mono">{source}</code>.
        What it declares is on the provides tab, where it links.
      </p>
      <pre className="mono overflow-x-auto rounded-card border border-line p-2 text-sm">
        {schema}
      </pre>
    </div>
  );
}
