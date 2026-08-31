import { useMemo, useState } from "react";
import { Link } from "react-router";
import { catalog } from "../data";
import type { AdrStatus } from "../catalog";
import { filterAdrs, scopeLabel, scopeOptions, sortAdrs } from "../lib/adr";
import {
  AdrNumber,
  AdrScopePill,
  AdrStatusChip,
} from "../components/primitives";
import { Empty } from "../components/PageHeader";
import { paths } from "../routes";
import { staggerStyle } from "../lib/motion";

const STATUSES: AdrStatus[] = [
  "accepted",
  "proposed",
  "superseded",
  "deprecated",
  "rejected",
];

function Facet({
  on,
  onClick,
  children,
  count,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      disabled={count === 0}
      /* No border of its own: it is one member of the facet group. */
      className={`flex items-center gap-1.5 ${on ? "is-on" : ""} ${
        count === 0 ? "opacity-40" : ""
      }`}
    >
      {children}
      <span className="tnum text-muted">{count}</span>
    </button>
  );
}

/**
 * A table, not cards: the number, the status and the date are the whole point,
 * and they only read as a column when they are in one.
 */
export function AdrIndex() {
  const [statuses, setStatuses] = useState<Set<AdrStatus>>(new Set());
  const [scopes, setScopes] = useState<Set<string>>(new Set());

  const all = useMemo(() => sortAdrs(catalog.adrs), []);
  const rows = useMemo(
    () => filterAdrs(all, { statuses, scopes }),
    [all, statuses, scopes],
  );

  const statusCount = (s: AdrStatus) =>
    all.filter((a) => a.status === s).length;
  const scopeCount = (label: string) =>
    all.filter((a) => scopeLabel(a.scope) === label).length;

  const toggle = <T,>(set: Set<T>, value: T): Set<T> => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  };

  return (
    <div className="h-full overflow-y-auto p-gutter">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold">Decisions</h1>
        <span className="mono text-muted">
          {rows.length} of {all.length}
        </span>

        <div className="ml-auto flex flex-wrap items-center gap-3">
          <div className="seg" role="group" aria-label="Filter by status">
            {STATUSES.map((s) => (
              <Facet
                key={s}
                on={statuses.has(s)}
                count={statusCount(s)}
                onClick={() => setStatuses((prev) => toggle(prev, s))}
              >
                {s}
              </Facet>
            ))}
          </div>
          <div className="seg" role="group" aria-label="Filter by scope">
            {scopeOptions(catalog).map((label) => (
              <Facet
                key={label}
                on={scopes.has(label)}
                count={scopeCount(label)}
                onClick={() => setScopes((prev) => toggle(prev, label))}
              >
                {label}
              </Facet>
            ))}
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="mt-section">
          <Empty>no decision matches this filter</Empty>
        </div>
      ) : (
        <div className="mt-section max-w-table overflow-hidden rounded-card border border-line shadow-xs">
          <table className="w-full">
            {/* The header pins itself over the rows it names, translucent so
                the reader can see the list still running underneath. */}
            <thead className="sticky-bar sticky top-0 z-10">
              <tr className="label border-b border-line text-left">
                <th className="px-4 py-2 font-normal">#</th>
                <th className="px-4 py-2 font-normal">title</th>
                <th className="px-4 py-2 font-normal">status</th>
                <th className="px-4 py-2 font-normal">scope</th>
                <th className="px-4 py-2 font-normal">date</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((adr, i) => (
                <tr
                  key={adr.id}
                  className="stagger-in border-b border-line last:border-b-0 t-micro transition-colors hover:bg-surface"
                  style={staggerStyle(i)}
                >
                  <td className="px-4 py-2 align-top whitespace-nowrap">
                    <AdrNumber adr={adr} />
                  </td>
                  <td className="px-4 py-2 align-top">
                    <Link
                      to={paths.adr(adr.slug)}
                      className="rounded-control hover:underline"
                      title={adr.title}
                    >
                      {adr.title}
                    </Link>
                  </td>
                  <td className="px-4 py-2 align-top">
                    <AdrStatusChip status={adr.status} />
                  </td>
                  <td className="px-4 py-2 align-top">
                    <AdrScopePill scope={adr.scope} />
                  </td>
                  <td className="mono px-4 py-2 align-top whitespace-nowrap text-muted">
                    {adr.date}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
