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
      className={`tbtn ${on ? "tbtn-on" : ""} ${count === 0 ? "opacity-40" : ""}`}
    >
      {children}
      <span className="text-muted">{count}</span>
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
    <div className="h-full overflow-y-auto p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-[15px] font-semibold">Decisions</h1>
        <span className="mono text-muted">
          {rows.length} of {all.length}
        </span>

        <div className="ml-auto flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap gap-1">
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
          <div className="flex flex-wrap gap-1">
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
        <div className="mt-3">
          <Empty>no decision matches this filter</Empty>
        </div>
      ) : (
        <table className="mt-3 w-full border border-line">
          <thead>
            <tr className="label border-b border-line bg-surface text-left">
              <th className="px-3 py-1.5 font-normal">#</th>
              <th className="px-3 py-1.5 font-normal">title</th>
              <th className="px-3 py-1.5 font-normal">status</th>
              <th className="px-3 py-1.5 font-normal">scope</th>
              <th className="px-3 py-1.5 font-normal">date</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((adr) => (
              <tr
                key={adr.id}
                className="border-b border-line last:border-b-0 hover:bg-surface"
              >
                <td className="px-3 py-1.5 align-top whitespace-nowrap">
                  <AdrNumber adr={adr} />
                </td>
                <td className="px-3 py-1.5 align-top">
                  <Link to={paths.adr(adr.slug)} className="hover:underline">
                    {adr.title}
                  </Link>
                </td>
                <td className="px-3 py-1.5 align-top">
                  <AdrStatusChip status={adr.status} />
                </td>
                <td className="px-3 py-1.5 align-top">
                  <AdrScopePill scope={adr.scope} />
                </td>
                <td className="mono px-3 py-1.5 align-top whitespace-nowrap text-muted">
                  {adr.date}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
