import { useEffect, useRef } from "react";
import { ArrowRight, CornerDownLeft, CornerDownRight } from "lucide-react";
import { statusVar } from "../components/primitives";
import type { OutlineFrame, OutlineRow, OutlineStep } from "./outline";

/**
 * A frame header. It is deliberately not a button: the frame is context for the
 * steps under it, not something you can select, and making it clickable would
 * put a second kind of selection on the rail.
 */
function FrameRow({ frame }: { frame: OutlineFrame }) {
  const choice = frame.keyword === "alt" || frame.keyword === "else";
  return (
    <div
      className="px-2 py-1"
      style={{
        paddingLeft: 8 + frame.depth * 10,
        background: "color-mix(in srgb, var(--fg) 3%, transparent)",
      }}
    >
      <div className="flex items-baseline gap-1.5">
        <span
          className="mono shrink-0 rounded-[4px] border px-1 uppercase"
          style={{
            borderColor: choice ? "var(--border-strong)" : "var(--border)",
            color: choice ? "var(--fg)" : "var(--fg-muted)",
          }}
        >
          {frame.keyword}
        </span>
        {frame.title ? (
          <span
            className="mono min-w-0 flex-1 truncate text-muted"
            title={frame.title}
          >
            {frame.title}
          </span>
        ) : null}
      </div>
      {/* On its own line: a branch that ends the flow is the whole reason the
          rail draws frames at all, and it must not be what the title truncates
          away in a narrow rail. */}
      {frame.terminal ? (
        <div
          className="mono mt-0.5 flex items-center gap-1"
          style={{ color: "var(--status-unresolved)" }}
          title="This branch ends the flow — the steps after this alt do not follow it"
        >
          <CornerDownRight size={9} aria-hidden className="shrink-0" />
          ends the flow — nothing below follows it
        </div>
      ) : null}
    </div>
  );
}

function StepRow({
  row,
  active,
  dimmed,
  onSelect,
  full,
}: {
  row: OutlineStep;
  active: boolean;
  dimmed: boolean;
  onSelect: (id: string) => void;
  full?: boolean;
}) {
  const { step, number, depth, hidden } = row;
  const self = step.from === step.to;
  return (
    <button
      type="button"
      onClick={() => onSelect(step.id)}
      /* Playback dims and undims at the narrative tier - the reader is meant to
         watch the sequence recede, not to be blinked at. The accent edge is
         always 2px and merely changes colour, so lighting a step never nudges
         the text beside it. */
      className={`flex w-full items-start gap-2 px-2 py-1.5 text-left t-narrative hover:bg-surface ${
        active ? "bg-raised pulse-once" : ""
      }`}
      style={{
        opacity: dimmed ? 0.3 : 1,
        borderLeftWidth: 2,
        borderLeftStyle: "solid",
        borderLeftColor: active ? "var(--accent)" : "transparent",
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
        className="mt-1 size-1.5 shrink-0 rounded-[1px]"
        style={{ background: statusVar(step.status) }}
        title={step.status}
      />
      <span className="min-w-0 flex-1">
        <span
          className="mono block truncate text-ink"
          title={step.label ?? step.ref ?? step.kind}
        >
          {step.label ?? step.ref ?? step.kind}
        </span>
        {/* Two ids on one line in a rail the reader can drag down to a
            quarter of the pane. Both are cut from the left, so what survives
            is the end that differs. */}
        <span className="mono flex items-center gap-1 text-muted">
          <span className="trunc-tail" title={step.from}>
            <bdi>{step.from}</bdi>
          </span>
          {self ? (
            <CornerDownLeft size={12} aria-hidden className="shrink-0" />
          ) : (
            <ArrowRight size={12} aria-hidden className="shrink-0" />
          )}
          <span className="trunc-tail" title={step.to}>
            <bdi>{step.to}</bdi>
          </span>
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
  );
}

export function StepRail({
  rows,
  activeId,
  matchIds,
  onSelect,
  full,
}: {
  rows: readonly OutlineRow[];
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
      {rows.map((row) =>
        row.type === "frame" ? (
          <li key={row.key}>
            <FrameRow frame={row} />
          </li>
        ) : (
          <li key={row.key} data-step={row.step.id}>
            <StepRow
              row={row}
              active={activeId === row.step.id}
              dimmed={matchIds ? !matchIds.has(row.step.id) : false}
              onSelect={onSelect}
              full={full}
            />
          </li>
        ),
      )}
    </ul>
  );
}
