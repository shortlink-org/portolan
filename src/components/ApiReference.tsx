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

import { lazy, useEffect, useRef, useState } from "react";
import { useTheme } from "../app/theme";
import { loaderFor as loaderIn } from "../lib/spec-files";
import { Empty } from "./PageHeader";
import { SuspenseReveal } from "./SuspenseReveal";

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
  [
    "../../**/openapi*.yaml",
    "../../**/openapi*.yml",
    "../../**/openapi*.json",
    "../../**/swagger*.yaml",
    "../../**/swagger*.yml",
    "../../**/swagger*.json",
    "../../examples/**/openapi*.yaml",
    "../../examples/**/openapi*.yml",
    "../../examples/**/openapi*.json",
    "../../examples/**/swagger*.yaml",
    "../../examples/**/swagger*.yml",
    "../../examples/**/swagger*.json",
    "../../vendor/repos/**/openapi*.yaml",
    "../../vendor/repos/**/openapi*.yml",
    "../../vendor/repos/**/openapi*.json",
    "../../vendor/repos/**/swagger*.yaml",
    "../../vendor/repos/**/swagger*.yml",
    "../../vendor/repos/**/swagger*.json",
    // Local onboarding writes generated documents under the project's
    // conventional portolan directory, wherever that project lives.
    "../../**/portolan/openapi*.yaml",
    "../../**/portolan/openapi*.yml",
    "../../**/portolan/openapi*.json",
    "!../../node_modules/**",
    "!../../dist/**",
    "!../../.portolan/**",
  ],
  { query: "?raw", import: "default" },
);

function loaderFor(source: string): (() => Promise<string>) | null {
  return loaderIn(SPECS, source);
}

/** Whether the document a catalog entry points at is one this site can show. */
export function hasSpec(source: string): boolean {
  return loaderFor(source) !== null;
}

/**
 * The operation's element inside the rendered reference, if it is there yet.
 *
 * Scalar ids an operation `<document>/tag/<tag>/<VERB><path>` - the document
 * and tag slugs come out of the spec's own text, which the catalog does not
 * carry, but the tail is the route exactly as the catalog records it. So the
 * element is found by how its id ENDS rather than by rebuilding the whole id,
 * and a request example under it (`…/example/…`) never ends that way.
 */
function operationElement(root: HTMLElement, operation: string): HTMLElement | null {
  const [verb, ...rest] = operation.trim().split(/\s+/);
  const path = rest.length > 0 ? rest.join(" ") : verb ?? "";
  const method = rest.length > 0 ? (verb ?? "").toUpperCase() : null;
  for (const element of root.querySelectorAll<HTMLElement>("[id]")) {
    const id = element.id;
    if (!id.endsWith(path)) continue;
    const head = id.slice(0, id.length - path.length);
    // A route with no proven verb takes whichever one the document gives it.
    if (method ? head.endsWith(`/${method}`) : /\/[A-Z]+$/.test(head)) return element;
  }
  return null;
}

export function ApiReference({
  source,
  operation = null,
}: {
  source: string;
  /** `POST /v1/users`: the operation to scroll to once the reference is drawn. */
  operation?: string | null;
}) {
  const { theme } = useTheme();
  const [spec, setSpec] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const frame = useRef<HTMLDivElement | null>(null);

  // The reference is lazy twice over - the chunk, then its own render of the
  // document - so the operation is looked for a frame at a time, the way
  // HashScroll waits for a section, only with longer patience. Not a hash:
  // Scalar owns the fragment on this tab and rewrites it as the reader scrolls.
  useEffect(() => {
    if (spec === null || !operation) return;
    const deadline = performance.now() + 8000;
    let handle = 0;
    const look = () => {
      const root = frame.current;
      const target = root ? operationElement(root, operation) : null;
      if (target) {
        handle = requestAnimationFrame(() =>
          target.scrollIntoView({ block: "start", behavior: "smooth" }),
        );
        return;
      }
      if (performance.now() < deadline) handle = requestAnimationFrame(look);
    };
    handle = requestAnimationFrame(look);
    return () => cancelAnimationFrame(handle);
  }, [spec, operation]);

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
    <div ref={frame} className="rounded-card border border-line">
      <SuspenseReveal fallback={<Empty>loading the reference…</Empty>}>
        <Reference
          configuration={{
            content: spec,
            // Its sidebar would be a second navigation tree beside the one the
            // app already has, listing the same endpoints.
            showSidebar: false,
            // Its search answers to ⌘K too, and would open over the app's own
            // palette - the one a reader just used to land on this operation.
            hideSearch: true,
            forceDarkModeState: theme,
          }}
        />
      </SuspenseReveal>
    </div>
  );
}
