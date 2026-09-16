import { useEffect, useId, useRef } from "react";
import { Link } from "react-router";
import { LayoutGroup, m, transitions } from "../lib/motion";
import {
  AlertCircle,
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
import { stepTitle } from "./chapters";
import type { Chapter } from "./chapters";
import { journeyRailRows } from "./journey";
import type { JourneyEntry, JourneyGroup, JourneyStep } from "./journey";
import type { OutlineFrame } from "./outline";

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
      {chapter.origin ? (
        <span className="mono shrink-0 rounded-[4px] border px-1 uppercase border-accent text-accent">
          fragment
        </span>
      ) : null}
      <span
        className="mono min-w-0 flex-1 truncate text-ink"
        title={chapter.title}
      >
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
            <span
              key={status}
              className="flex items-center gap-0.5"
              title={status}
            >
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
      style={
        context ? ctxStyle(context) : { borderColor: "var(--border-strong)" }
      }
      title={`crosses into ${label}`}
    >
      → {label}
    </span>
  );
}

/** What a branch did to a step, drawn on its row. */
export interface RailMark {
  state: "added" | "changed" | "removed" | "main";
  was?: string;
  note?: string;
}

const MARK_COLOR: Record<RailMark["state"], string> = {
  added: "var(--status-verified)",
  changed: "var(--accent)",
  removed: "var(--fg-muted)",
  main: "var(--status-unresolved)",
};

const MARK_GLYPH: Record<RailMark["state"], string> = {
  added: "+",
  changed: "~",
  removed: "−",
  main: "!",
};

const MARK_TITLE: Record<RailMark["state"], string> = {
  added: "added in the branch",
  changed: "changed in the branch",
  removed: "removed in the branch",
  main: "changed on main since the branch's base",
};

function StepRow({
  row,
  answer,
  active,
  dimmed,
  onSelect,
  onHover,
  crossContext,
  full,
  mark,
}: {
  row: JourneyStep;
  /** What the callee hands back, when a contract says. */
  answer?: string | undefined;
  active: boolean;
  dimmed: boolean;
  /** The row's key, not the step's id: a followed flow numbers its steps from one too. */
  onSelect: (key: string) => void;
  onHover: (key: string | null) => void;
  /** The context this step crosses into, or undefined when it stays home. */
  crossContext?: string | null | undefined;
  full?: boolean;
  mark?: RailMark | undefined;
}) {
  const { step, number, depth, hidden, offPath, offStatus, key } = row;
  const self = step.from === step.to;
  const crosses = crossContext !== undefined;
  const errorResponse = step.http?.outcome === "error";
  return (
    <div
      onMouseEnter={() => onHover(key)}
      onMouseLeave={() => onHover(null)}
      style={{ opacity: dimmed || offPath || offStatus ? 0.3 : 1 }}
    >
      <button
        type="button"
        data-nav-item
        onClick={() => onSelect(key)}
        /* Focus lights the canvas arrow the way hover does: j and k walk the
           rail, and the reader walking it should see where each step goes. */
        onFocus={() => onHover(key)}
        onBlur={() => onHover(null)}
        /* Playback dims and undims at the narrative tier - the reader is meant to
           watch the sequence recede, not to be blinked at. The edge is always
           2px and transparent, so lighting a step never nudges the text beside
           it; the light itself is the one element below, which slides from the
           step it was on to this one. `isolate` keeps its -z under the text but
           above the rail. */
        className="relative isolate flex w-full items-start gap-2 px-2 py-1.5 text-left t-narrative hover:bg-surface"
        style={{
          borderLeftWidth: 2,
          borderLeftStyle: "solid",
          borderLeftColor: mark
            ? MARK_COLOR[mark.state]
            : errorResponse
              ? "var(--response-error)"
              : "transparent",
          paddingLeft: 8 + depth * 10,
          background: mark
            ? `color-mix(in srgb, ${MARK_COLOR[mark.state]} 8%, transparent)`
            : errorResponse
              ? "var(--response-error-bg)"
              : undefined,
          textDecoration: mark?.state === "removed" ? "line-through" : undefined,
        }}
        aria-current={active ? "true" : undefined}
      >
        {active ? (
          <m.span
            layoutId="active-step"
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-0 -left-0.5 -z-10 border-l-2 border-accent bg-raised"
            transition={transitions.settle}
          />
        ) : null}
        <span
          className={`mono w-5 shrink-0 text-right t-micro transition-colors ${active ? "text-accent" : "text-muted"}`}
        >
          {number}
        </span>
        <span className="min-w-0 flex-1">
          <span className="mono flex items-baseline gap-1">
            {/* No flex-1 here: a basis of zero makes shrinking proportional
                to nothing, and the label collapses before the answer gives up
                a character. Both sit on their content and the answer, weighted
                to give way ten times faster, is the one that loses. */}
            <span
              className="min-w-0 truncate"
              style={{
                color: errorResponse ? "var(--response-error)" : "var(--fg)",
              }}
              title={stepTitle(step)}
            >
              {stepTitle(step)}
            </span>
            {mark ? (
              <span
                className="mono ml-auto shrink-0 pl-1"
                style={{ color: MARK_COLOR[mark.state] }}
                title={MARK_TITLE[mark.state]}
              >
                {MARK_GLYPH[mark.state]}
              </span>
            ) : null}
            {/* A standalone call keeps its contract answer on this line. Once
                composition proves the nested return, the answer becomes its
                own response step and is omitted from this map. */}
            {/* Only where there is room for it: two truncated halves read
                worse than one whole label, so on a rail dragged narrow the
                answer steps aside and the step's own panel still says it. */}
            {answer ? (
              <span
                className={`min-w-0 shrink-[10] truncate text-muted ${full ? "" : "hidden @[16rem]:inline"}`}
                title={`answers with ${answer}`}
              >
                → {answer}
              </span>
            ) : null}
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
        {errorResponse ? (
          <AlertCircle
            size={12}
            aria-label="error response"
            className="mt-0.5 shrink-0"
            style={{ color: "var(--response-error)" }}
          />
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
    </div>
  );
}

/**
 * Where this flow hands the story over, as a door rather than a link.
 *
 * The link is still there - a reader who wants that flow on its own page is
 * one click away - but the control beside it opens the other flow's steps
 * here, under the step that calls it, which is the question "and then what?"
 * answered without leaving the page.
 */
function EntryRow({
  row,
  onToggle,
}: {
  row: JourneyEntry;
  onToggle: (key: string) => void;
}) {
  const { via, open, steps, service, repeats, deepest } = row;
  const Chevron = open ? ChevronDown : ChevronRight;
  const stopped = repeats ? "already on this path" : deepest ? "as deep as this goes" : null;
  const what = via.kind === "event" ? "related event flow" : "continues";
  return (
    <div
      className="mono flex items-center gap-1 py-0.5 pr-2 text-muted"
      style={{ paddingLeft: 8 + row.depth * 10 }}
      title={`${via.confidence}-confidence ${via.kind} continuation: ${via.basis}`}
    >
      {stopped ? (
        <CornerDownRight size={9} aria-hidden className="shrink-0" />
      ) : (
        <button
          type="button"
          onClick={() => onToggle(row.key)}
          aria-expanded={open}
          className="flex shrink-0 items-center gap-1 text-accent hover:underline"
        >
          <Chevron size={11} aria-hidden className="shrink-0" />
          {open ? "hide" : "follow"}
        </button>
      )}
      <span className="min-w-0 truncate">
        {what} in{" "}
        <Link to={paths.flow(via.slug)} className="text-accent hover:underline">
          {via.name}
        </Link>
      </span>
      {service ? (
        <span className="shrink-0 truncate" title={service}>
          · {service}
        </span>
      ) : null}
      <span className="ml-auto shrink-0 pl-2">
        {stopped ?? `${steps} ${steps === 1 ? "step" : "steps"}`}
      </span>
    </div>
  );
}

export function StepRail({
  groups,
  answers,
  activeId,
  matchIds,
  collapsed,
  onToggleChapter,
  onSelect,
  onHover,
  onToggleEntry,
  crossContextOf,
  full,
  marks,
}: {
  /** What a branch did to each step, by step id. */
  marks?: ReadonlyMap<string, RailMark> | undefined;
  /** The rail's rows, already cut into chapters, with the path opened into them. */
  groups: readonly JourneyGroup[];
  /** What each step's callee hands back, by step id; see flow/answers.ts. */
  answers: ReadonlyMap<string, string>;
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
  onSelect: (key: string) => void;
  /** Hovering a step lights its arrow on the canvas, and nothing else. */
  onHover: (key: string | null) => void;
  /** Opens or closes one continuation, by the key the address carries. */
  onToggleEntry: (key: string) => void;
  /** The context a step crosses into; undefined for a step that crosses none. */
  crossContextOf: (step: Step) => string | null | undefined;
  full?: boolean;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  // Namespaces the light's layoutId to this rail, for a screen with two.
  const railId = useId();

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
    // A container so a row can ask how wide the rail is: the reader drags it,
    // and what fits at half a pane does not fit at a quarter.
    <div ref={listRef} data-nav-list className="@container">
      <LayoutGroup id={railId}>
        {groups.map((group) => {
          const { chapter } = group;
          const rows = journeyRailRows(group);
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
                    ) : row.type === "entered" ? (
                      <li key={row.key}>
                        <EntryRow row={row} onToggle={onToggleEntry} />
                      </li>
                    ) : (
                      <li key={row.key} data-step={row.key}>
                        <StepRow
                          row={row}
                          answer={answers.get(row.key)}
                          active={activeId === row.key}
                          /* A followed flow's steps are another story's, and
                             an event selected in this one does not dim them. */
                          dimmed={matchIds && !row.origin ? !matchIds.has(row.key) : false}
                          onSelect={onSelect}
                          onHover={onHover}
                          crossContext={crossContextOf(row.step)}
                          full={full}
                          mark={marks?.get(row.key)}
                        />
                      </li>
                    ),
                  )}
                </ul>
              )}
            </section>
          );
        })}
      </LayoutGroup>
    </div>
  );
}
