import { Popover, PopoverButton, PopoverPanel } from "@headlessui/react";
import { catalog, catalogSources } from "../data";
import type { SourceStamp } from "../merge";
import { absoluteTime, plural, relativeTime } from "../lib/format";

/**
 * Where the catalog on this page came from, and when.
 *
 * The header says one date and one commit, and both are summaries of a corpus:
 * the date is the OLDEST of the sources, because a merged catalog is exactly
 * as fresh as its stalest part, and the commit is a count whenever the sources
 * do not agree on one. A summary of many numbers is the right thing to put in
 * a header and the wrong thing to leave a reader with - "6 sources · 15 hours
 * ago" answers "is this current" and refuses "which part is not", which is the
 * question anyone who did not like the first answer asks next.
 *
 * So the stamp opens. Behind it is one row per commit, newest first, and the
 * row the header is quoting says so. Rows are per COMMIT and not per file
 * because twenty-eight fragments written by one commit are one source of
 * facts, and it is the same count the header prints.
 */
export function CatalogStamp() {
  const groups = byCommit(catalogSources);
  const authored = catalogSources.filter((source) => !source.commit);
  const summary = `catalog generated ${absoluteTime(catalog.generatedAt)} from commit ${catalog.commit}`;

  return (
    <Popover className="ml-auto">
      <PopoverButton
        title={summary}
        aria-label={`Catalog provenance — ${summary}`}
        className={({ open }) =>
          `mono rounded-control px-1 py-0.5 transition-colors hover:text-ink focus:outline-none ${
            open ? "text-accent" : "text-muted"
          }`
        }
      >
        catalog {catalog.commit} · {relativeTime(catalog.generatedAt)}
      </PopoverButton>
      <PopoverPanel
        anchor={{ to: "bottom end", gap: 4, padding: 8 }}
        className="palette-in z-50 w-[26rem] max-w-[92vw] rounded-control border bg-canvas p-2 border-line-strong shadow-md focus:outline-none"
      >
        <div className="label mb-1.5 px-1">
          {groups.length} {plural(groups.length, "source")}, by the commit each
          was generated from
        </div>
        <dl className="mono grid grid-cols-[auto_1fr_auto] items-baseline gap-x-3 gap-y-1 px-1">
          {groups.map((group, i) => (
            <div key={group.commit} className="contents">
              <dt className="text-ink">{group.commit}</dt>
              {/* The root truncates, the "+2" does not: a commit that stamped
                  three roots is a different fact from one that stamped one,
                  and it is the first thing a narrow panel would eat. */}
              <dd
                className="flex min-w-0 gap-1.5 text-muted"
                title={group.roots.join(", ")}
              >
                <span className="truncate">{group.roots[0]}</span>
                {group.roots.length > 1 ? (
                  <span className="shrink-0 text-line-strong">
                    +{group.roots.length - 1}
                  </span>
                ) : null}
              </dd>
              {/* The last row is the oldest, and the oldest is the one the
                  header is dating the whole catalog from. Saying so here is
                  what turns the header from a number into a claim a reader
                  can go and check. */}
              <dd
                className={i === groups.length - 1 ? "text-ink" : "text-muted"}
                title={absoluteTime(group.generatedAt)}
              >
                {relativeTime(group.generatedAt)}
                {i === groups.length - 1 ? (
                  <span className="ml-1.5 text-muted">oldest</span>
                ) : null}
              </dd>
            </div>
          ))}
        </dl>
        {authored.length > 0 ? (
          // A file no plugin produces has no commit to be stamped from, and a
          // date typed in by hand would be a claim nothing keeps true. It is
          // named here rather than left out, because "where did this come
          // from" is a question about every source and not only the dated
          // ones.
          <div className="mono mt-2 border-t px-1 pt-2 border-line text-muted">
            {authored.map((source) => (
              <div key={source.path} className="truncate" title={source.path}>
                {source.path}
                <span className="ml-1.5 text-line-strong">
                  authored, stamped by nobody
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </PopoverPanel>
    </Popover>
  );
}

/** One row per commit: what it stamped, and when it was made. */
interface Provenance {
  commit: string;
  generatedAt: string;
  /** The input roots it stamped, as a reader would type them. */
  roots: string[];
}

/**
 * Groups the stamps by commit, newest first, so the list ends on the row the
 * header quotes. A stamp nobody can parse sorts to the end with the oldest,
 * where it is visible rather than scattered mid-list.
 */
function byCommit(sources: SourceStamp[]): Provenance[] {
  const groups = new Map<string, Provenance>();

  for (const source of sources) {
    if (!source.commit) continue;
    const root = rootOf(source.path);
    const group = groups.get(source.commit);
    if (!group) {
      groups.set(source.commit, {
        commit: source.commit,
        generatedAt: source.generatedAt,
        roots: [root],
      });
      continue;
    }
    if (!group.roots.includes(root)) group.roots.push(root);
  }

  return [...groups.values()].sort((a, b) => {
    const at = Date.parse(a.generatedAt);
    const bt = Date.parse(b.generatedAt);
    if (Number.isNaN(at)) return 1;
    if (Number.isNaN(bt)) return -1;

    return bt - at;
  });
}

/**
 * The directory a fragment describes, rather than the directory it sits in:
 * a service publishes into `portolan/` beside its code, and that last segment
 * is the same on every row and says nothing.
 */
function rootOf(path: string): string {
  const cut = path.lastIndexOf("/");
  const dir = cut === -1 ? path : path.slice(0, cut);

  return dir.replace(/\/portolan$/, "");
}
