// The chip-set a status, kind or context column offers.
//
// Values come from the data, never from a list written next to it: a facet
// that offers "deprecated" on a page where nothing is deprecated is a filter
// that can only ever return nothing. The count next to each value is what
// makes the set worth reading before it is clicked.

import type { ReactNode } from "react";

export interface FacetValue {
  value: string;
  count: number;
  label?: ReactNode;
}

export function Facets({
  label,
  values,
  selected,
  onToggle,
}: {
  /** Names the group for a reader who cannot see it. The column's header. */
  label: string;
  values: readonly FacetValue[];
  selected: readonly string[];
  onToggle: (value: string) => void;
}) {
  if (values.length === 0) return null;
  return (
    <div className="seg" role="group" aria-label={`Filter by ${label}`}>
      {values.map((facet) => {
        const on = selected.includes(facet.value);
        return (
          <button
            key={facet.value}
            type="button"
            onClick={() => onToggle(facet.value)}
            aria-pressed={on}
            /* A value with nothing behind it is left in place rather than
               removed: a set that changes shape as it is used is a set the
               reader has to re-read after every click. */
            disabled={facet.count === 0 && !on}
            className={`flex items-center gap-1.5 ${on ? "is-on" : ""} ${
              facet.count === 0 && !on ? "opacity-40" : ""
            }`}
          >
            {facet.label ?? facet.value}
            <span className="tnum text-muted">{facet.count}</span>
          </button>
        );
      })}
    </div>
  );
}
