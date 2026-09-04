import { useEffect, useRef } from "react";
import { Link } from "react-router";
import {
  ArrowRight,
  ChevronDown,
  ChevronRight,
  CornerDownLeft,
  CornerDownRight,
} from "lucide-react";
import type { Step } from "../catalog";
import { STATUSES } from "../catalog";
import { contextName, ctxStyle } from "../lib/context-color";
import { paths } from "../routes";
import { statusVar } from "../components/primitives";
import { railRows } from "./chapters";
import type { Chapter, ChapterGroup } from "./chapters";
import type { Continuation } from "./continues";
import type { OutlineFrame, OutlineStep } from "./outline";



/**
 * A chapter header. The one row on the rail that is a control rather than a
 * reading: it folds its own steps away and nothing else — the canvas keeps
 * drawing them, because a chapter is how the reader is walking the list, not a
 * claim about what the flow does.
 */
function ChapterRow({
  chapter,
  collapsed,
  onToggle,
}: {
  chapter: Chapter;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const Chevron = collapsed ? ChevronRight : ChevronDown;
  const range =
    chapter.from === chapter.to
      ? `${chapter.from}`
      : `${chapter.from}–${chapter.to}`;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      className="chapter-row"
      title={
        collapsed
          ? `Show steps ${range} — ${chapter.title}`
          : `Hide steps ${range} — ${chapter.title}`
      }
    >
      {/* This header stands in for the frame's own opening row, so the one
          thing that row would have shouted has to be shouted here too. */}
      {chapter.terminal ? (
        <CornerDownRight
          size={10}
          aria-hidden
          className="shrink-0"
          style={{ color: "var(--status-unresolved)" }}
        />
      ) : null}
      <Chevron size={12} aria-hidden className="shrink-0 text-muted" />
      {chapter.kind === "steps" ? null : (
        <span className="mono shrink-0 rounded-[4px] border px-1 uppercase border-line-strong text-muted">
          {chapter.kind}
        </span>
      )}
      <span className="mono min-w-0 flex-1 truncate text-ink" title={chapter.title}>
        {chapter.title}
      </span>
      {/* The contexts this episode touches, as colour and nothing else: the
          rail has no room for three names, and the names are one hover away. */}
      <span className="flex shrink-0 items-center gap-0.5">
        {chapter.contexts.map((id) => (
          <span
            key={id}
            aria-hidden
            className="size-1.5 rounded-[1px] ctx"
            style={{ ...ctxStyle(id), background: "var(--ctx)" }}
            title={contextName(id)}
          />
        ))}
      </span>
      {/* Status as a count per colour rather than one dot per step: a chapter
          of twelve steps would otherwise be a bar chart nobody asked for. */}
      <span className="mono flex shrink-0 items-center gap-1 text-muted">
        {STATUSES.filter((status) => chapter.status[status] > 0).map(
          (status) => (
            <span key={status} className="flex items-center gap-0.5" title={status}>
              <span
                aria-hidden
                className="size-1.5 rounded-[1px]"
                style={{ background: statusVar(status) }}
              />
              <span className="tnum">{chapter.status[status]}</span>
            </span>
          ),
        )}
      </span>
      <span className="mono tnum shrink-0 text-faint">{range}</span>
    </button>
  );
}

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
        opacity: frame.offPath ? 0.35 : 1,
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

/**
 * Where a step leaves the context it was in. This is the first thing the eye
 * should catch on the rail: every other fact about a step is local to the
 * service that runs it, and this one is the only one that is somebody else's
 * problem.
 */
function CrossChip({ step, context }: { step: Step; context: string | null }) {
  const label = context ? contextName(context) : step.to;
  return (
    <span
      className="chip shrink-0 ctx"
      style={context ? ctxStyle(context) : { borderColor: "var(--border-strong)" }}
      title={`crosses into ${label}`}
    >
      → {label}
    </span>
  );
}

function StepRow({
  row,
  active,
  dimmed,
  onSelect,
  onHover,
  crossContext,
  continuations,
  full,
}: {
  row: OutlineStep;
  active: boolean;
  dimmed: boolean;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
  /** The context this step crosses into, or undefined when it stays home. */
  crossContext?: string | null | undefined;
  continuations: readonly Continuation[];
  full?: boolean;
}) {
  const { step, number, depth, hidden, offPath, offStatus } = row;
  const self = step.from === step.to;
  const crosses = crossContext !== undefined;
  return (
    <div
      onMouseEnter={() => onHover(step.id)}
      onMouseLeave={() => onHover(null)}
      style={{ opacity: dimmed || offPath || offStatus ? 0.3 : 1 }}
    >
      <button
        type="button"
        data-nav-item
        onClick={() => onSelect(step.id)}
        /* Focus lights the canvas arrow the way hover does: j and k walk the
           rail, and the reader walking it should see where each step goes. */
        onFocus={() => onHover(step.id)}
        onBlur={() => onHover(null)}
        /* Playback dims and undims at the narrative tier - the reader is meant to
           watch the sequence recede, not to be blinked at. The accent edge is
           always 2px and merely changes colour, so lighting a step never nudges
           the text beside it. */
        className={`flex w-full items-start gap-2 px-2 py-1.5 text-left t-narrative hover:bg-surface ${
          active ? "bg-raised pulse-once" : ""
        }`}
        style={{
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
        {crosses ? <CrossChip step={step} context={crossContext} /> : null}
        {hidden ? (
          <span
            className="mono shrink-0 text-muted"
            title="hidden by the cross-context filter"
          >
            ·
          </span>
        ) : null}
        {/* Last, and always last: the status dot is the column the eye runs
            down when it is asking one question of forty steps at once. */}
        <span
          aria-hidden
          className="mt-1 size-1.5 shrink-0 rounded-[1px]"
          style={{ background: statusVar(step.status) }}
          title={step.status}
        />
      </button>
      {/* Where this step hands the story over. Outside the button because it is
          a different destination from the step's own selection, and nesting a
          link inside a button is not a thing the DOM allows. */}
      {continuations.map((next) => (
        <Link
          key={next.slug}
          to={paths.flow(next.slug)}
          className="mono flex items-center gap-1 py-0.5 pr-2 text-accent hover:underline"
          style={{ paddingLeft: 8 + depth * 10 + 28 }}
          title={`this event opens ${next.name}`}
        >
          <CornerDownRight size={9} aria-hidden className="shrink-0" />
          continues in {next.name}
        </Link>
      ))}
    </div>
  );
}

export function StepRail({
  groups,
  activeId,
  matchIds,
  collapsed,
  onToggleChapter,
  onSelect,
  onHover,
  crossContextOf,
  continuations,
  full,
}: {
  /** The rail's rows, already cut into chapters. */
  groups: readonly ChapterGroup[];
  /** The step the rail marks and scrolls to. */
  activeId: string | null;
  /**
   * When set, only these steps read at full strength. Used when an event is
   * selected somewhere else: every step that carries it stays lit, and the
   * rest of the sequence recedes.
   */
  matchIds?: ReadonlySet<string> | null;
  collapsed: ReadonlySet<string>;
  onToggleChapter: (chapterId: string) => void;
  onSelect: (id: string) => void;
  /** Hovering a step lights its arrow on the canvas, and nothing else. */
  onHover: (id: string | null) => void;
  /** The context a step crosses into; undefined for a step that crosses none. */
  crossContextOf: (step: Step) => string | null | undefined;
  continuations: ReadonlyMap<string, Continuation[]>;
  full?: boolean;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!activeId || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(
      `[data-step="${CSS.escape(activeId)}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [activeId]);

  return (
    /* `data-nav-list`: j / k walk the steps and ⏎ selects the one under the
       cursor, the same keys that walk every table. Chapter and frame rows are
       not items - a chapter folds, it is not somewhere to stand. */
    <div ref={listRef} data-nav-list>
      {groups.map((group) => {
        const { chapter } = group;
        const rows = railRows(group);
        const folded = collapsed.has(chapter.id);
        return (
          <section key={chapter.id}>
            <ChapterRow
              chapter={chapter}
              collapsed={folded}
              onToggle={() => onToggleChapter(chapter.id)}
            />
            {folded ? null : (
              <ul className="divide-y divide-line">
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
                        onHover={onHover}
                        crossContext={crossContextOf(row.step)}
                        continuations={continuations.get(row.step.id) ?? []}
                        full={full}
                      />
                    </li>
                  ),
                )}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
