import { useEffect, useRef } from "react";
import { ArrowRight, CornerDownLeft } from "lucide-react";
import type { Step } from "../catalog";
import { statusVar } from "../components/primitives";

export interface RailItem {
  step: Step;
  number: number;
  depth: number;
  hidden: boolean;
}

export function StepRail({
  items,
  activeId,
  matchIds,
  onSelect,
  full,
}: {
  items: RailItem[];
  /** The step the rail marks and scrolls to. */
  activeId: string | null;
  /**
   * When set, only these steps read at full strength. Used when an event is
   * selected somewhere else: every step that carries it stays lit, and the
   * rest of the sequence recedes.
   */
  matchIds?: ReadonlySet<string> | null;
  onSelect: (id: string) => void;
  full?: boolean;
}) {
  const listRef = useRef<HTMLUListElement | null>(null);

  useEffect(() => {
    if (!activeId || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(
      `[data-step="${CSS.escape(activeId)}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [activeId]);

  return (
    <ul ref={listRef} className="divide-y divide-line">
      {items.map(({ step, number, depth, hidden }) => {
        const active = activeId === step.id;
        const dimmed = matchIds ? !matchIds.has(step.id) : false;
        const self = step.from === step.to;
        return (
          <li key={step.id} data-step={step.id}>
            <button
              type="button"
              onClick={() => onSelect(step.id)}
              className={`flex w-full items-start gap-2 px-2 py-1.5 text-left hover:bg-surface ${
                active ? "bg-raised" : ""
              }`}
              style={{
                opacity: dimmed ? 0.3 : 1,
                borderLeft: `2px solid ${active ? "var(--accent)" : "transparent"}`,
                paddingLeft: 8 + depth * 10,
              }}
              aria-current={active ? "true" : undefined}
            >
              <span
                className={`mono w-5 shrink-0 text-right ${active ? "text-accent" : "text-muted"}`}
              >
                {number}
              </span>
              <span
                aria-hidden
                className="mt-1 size-1.5 shrink-0"
                style={{ background: statusVar(step.status) }}
                title={step.status}
              />
              <span className="min-w-0 flex-1">
                <span className="mono block truncate text-ink">
                  {step.label ?? step.ref ?? step.kind}
                </span>
                <span className="mono flex items-center gap-1 truncate text-muted">
                  <span className="truncate">{step.from}</span>
                  {self ? (
                    <CornerDownLeft size={9} aria-hidden className="shrink-0" />
                  ) : (
                    <ArrowRight size={9} aria-hidden className="shrink-0" />
                  )}
                  <span className="truncate">{step.to}</span>
                </span>
              </span>
              {full ? (
                <span className="mono shrink-0 text-muted">{step.kind}</span>
              ) : null}
              {hidden ? (
                <span
                  className="mono shrink-0 text-muted"
                  title="hidden by the cross-context filter"
                >
                  ·
                </span>
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
