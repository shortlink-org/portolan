// The C4 levels, in one vocabulary.
//
// Three pictures, three scopes, and a reader who has to be told which one they
// are looking at — a box called "Payments" is a system on one page and a
// container on the next, and the only thing that says which is the level.
//
// The levels are not a menu of everything LikeC4 could draw. They are the
// scopes the catalog actually holds facts about: the estate and what stands
// outside it, the containers of one context, and the parts of one service.
// There is no level 4 here, because code is what the repository is for.

import type { ReactNode } from "react";

export type C4Level = 1 | 2 | 3;

export const C4_LEVEL: Record<C4Level, { name: string; note: string }> = {
  1: {
    name: "system context",
    note: "every bounded context, and everything outside the estate that touches one",
  },
  2: {
    name: "containers",
    note: "services, and the stores they keep their state in",
  },
  3: {
    name: "components",
    note: "the aggregates inside one service, and where each is persisted",
  },
};

/** Says which level a canvas is drawn at, for a page that only draws one. */
export function LevelBadge({ level }: { level: C4Level }) {
  return (
    <span className="mono text-muted" title={C4_LEVEL[level].note}>
      C4 L{level} · {C4_LEVEL[level].name}
    </span>
  );
}

/**
 * Steps between the levels one page can draw. A segmented control rather than
 * tabs: the picture underneath stays where it is, and only its scope changes.
 */
export function LevelSwitch({
  levels,
  level,
  onLevel,
}: {
  /** The levels this page offers, with the word each one goes by here. */
  levels: { level: C4Level; label: ReactNode }[];
  level: C4Level;
  onLevel: (level: C4Level) => void;
}) {
  return (
    <div className="seg">
      {levels.map((option) => (
        <button
          key={option.level}
          type="button"
          onClick={() => onLevel(option.level)}
          aria-pressed={option.level === level}
          title={C4_LEVEL[option.level].note}
          className={option.level === level ? "is-on" : ""}
        >
          L{option.level} {option.label}
        </button>
      ))}
    </div>
  );
}
