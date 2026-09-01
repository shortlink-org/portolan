// One bar for one canvas.
//
// The flow page used to carry two sets of controls: portolan's, in the page
// header, and LikeC4's, floating over the top-left corner of its own canvas.
// They overlapped — both offered the variant, both offered fit — and they
// disagreed about where a control lives and what it looks like. So LikeC4's
// panel is switched off at the prop, and everything it held is here, in the
// app's own vocabulary, on one row.
//
// The order is the order a reader needs them: what am I looking at (variant),
// play it for me (walkthrough), narrow it (branch, cross-context), leave the
// picture behind (compact), get me out of the weeds (fit).

import {
  Columns3,
  Filter,
  Maximize2,
  Network,
  Pause,
  Play,
  Rows3,
  SkipBack,
  SkipForward,
  TriangleAlert,
  Workflow,
} from "lucide-react";
import type { ReactNode } from "react";
import { Ident } from "../components/Ident";
import { Select } from "../components/Select";
import type { FlowPath } from "./paths";
import type { Variant } from "./prefs";

/**
 * A switch inside a segmented control. It carries no border of its own: the
 * group draws one, and the hairline between members does the rest.
 */
function Toggle({
  on,
  onClick,
  icon: Icon,
  children,
  title,
}: {
  on: boolean;
  onClick: () => void;
  icon: typeof Filter;
  children?: ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      title={title}
      className={`flex items-center gap-1.5 ${on ? "is-on" : ""}`}
    >
      <Icon size={14} aria-hidden />
      {children}
    </button>
  );
}

export function FlowToolbar({
  variant,
  onVariant,
  playing,
  onPlay,
  onStep,
  onStop,
  onFit,
  paths,
  pathId,
  onPath,
  pathSteps,
  totalSteps,
  crossOnly,
  onCrossOnly,
  compact,
  onCompact,
  viewId,
  hiddenCount,
  pairingBroken,
}: {
  variant: Variant;
  onVariant: (variant: Variant) => void;
  playing: boolean;
  onPlay: () => void;
  onStep: (delta: 1 | -1) => void;
  onStop: () => void;
  onFit: () => void;
  paths: readonly FlowPath[];
  pathId: string;
  onPath: (id: string) => void;
  /** Steps on the chosen path, when one is chosen. */
  pathSteps: number | null;
  totalSteps: number;
  crossOnly: boolean;
  onCrossOnly: (value: boolean) => void;
  compact: boolean;
  onCompact: (value: boolean) => void;
  /** The LikeC4 view currently on the canvas. Changes with variant and filter. */
  viewId: string;
  /** Steps the cross-context filter is leaving out, or 0 when it is off. */
  hiddenCount: number;
  /** The generated view and the catalog disagree, so nothing can be paired. */
  pairingBroken: boolean;
}) {
  return (
    <div className="flow-toolbar">
      <div className="seg">
        <Toggle
          on={variant === "diagram"}
          onClick={() => onVariant("diagram")}
          icon={Network}
          title="Draw the flow as a diagram — lanes fold together, order is numbered"
        >
          diagram
        </Toggle>
        <Toggle
          on={variant === "sequence"}
          onClick={() => onVariant("sequence")}
          icon={Workflow}
          title="Draw the flow as a sequence — order is position, one row per step"
        >
          sequence
        </Toggle>
      </div>

      {/* Playback is LikeC4's animation, driven from here. The transport only
          appears once something is running: a stop button for a stopped
          picture is a control that does nothing. */}
      <div className="seg">
        {playing ? (
          <>
            <button
              type="button"
              onClick={() => onStep(-1)}
              title="Previous step"
              aria-label="Previous step"
              className="!px-1.5"
            >
              <SkipBack size={14} aria-hidden />
            </button>
            <button
              type="button"
              onClick={onStop}
              title="Stop the walkthrough"
              className="flex items-center gap-1.5"
            >
              <Pause size={14} aria-hidden />
              stop
            </button>
            <button
              type="button"
              onClick={() => onStep(1)}
              title="Next step"
              aria-label="Next step"
              className="!px-1.5"
            >
              <SkipForward size={14} aria-hidden />
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={onPlay}
            title="Walk the flow one step at a time"
            className="flex items-center gap-1.5"
          >
            <Play size={14} aria-hidden />
            walkthrough
          </button>
        )}
      </div>

      {/* Only a flow that actually forks gets a path picker; for the others
          there is one path and naming it would be noise. */}
      {paths.length > 1 ? (
        <div className="flex min-w-0 items-center gap-1.5 text-muted">
          <Select
            value={pathId}
            onChange={onPath}
            label="Path through this flow"
            title="Grey out everything that does not run on one path through this flow"
            // A path's name is every condition along it, which on a flow with
            // five forks is a sentence. It is capped here rather than shortened
            // in the data: the menu still shows the whole thing, and the bar
            // must not grow a row because one branch was chosen.
            className="max-w-44"
            menuWidth={320}
            options={[
              { value: "", label: "all branches" },
              ...paths.map((p) => ({
                value: p.id,
                label: p.label,
                ...(p.terminal ? { note: "ends the flow" } : {}),
              })),
            ]}
          />
          {/* How much of the flow the chosen path is. A count, not a score:
              the steps of one run are comparable to the steps of the whole
              tree, and nothing else about the two numbers is. */}
          {pathSteps === null ? null : (
            <span
              className="chip border-line-strong"
              title="Steps that run on the chosen path, of every step this flow declares"
            >
              path <span className="tnum">{pathSteps}</span> of{" "}
              <span className="tnum">{totalSteps}</span> steps
            </span>
          )}
        </div>
      ) : null}

      {/* The count of what is not on screen is the one control that can put it
          back, so it is the button that does — and it sits with the switch
          that took the steps away rather than up among the flow's own facts. */}
      {hiddenCount > 0 ? (
        <button
          type="button"
          onClick={() => onCrossOnly(false)}
          title="Show the steps this view is leaving out"
          className="mono rounded-control text-muted hover:text-ink"
        >
          <span className="tnum">{hiddenCount}</span> step
          {hiddenCount === 1 ? "" : "s"} hidden — show them
        </button>
      ) : null}

      {pairingBroken ? (
        <span
          className="mono flex items-center gap-1 status-unresolved"
          title="The generated view and the catalog disagree on how many steps this flow has, so a step cannot be matched to its arrow. Re-run `npm run likec4:gen`."
        >
          <TriangleAlert size={11} aria-hidden />
          diagram highlighting unavailable
        </span>
      ) : null}

      <div className="ml-auto flex items-center gap-2">
        {/* Which view is actually on the canvas. It changes with both switches
            on this bar, which is the argument for it being on this bar. */}
        <Ident
          value={viewId}
          className="text-muted"
          title={`LikeC4 view ${viewId} — click to copy`}
        />
        <div className="seg">
          <Toggle
            on={crossOnly}
            onClick={() => onCrossOnly(!crossOnly)}
            icon={Filter}
            title="Switch to the declared crossings-only view"
          >
            cross-context only
          </Toggle>
          <Toggle
            on={compact}
            onClick={() => onCompact(!compact)}
            icon={compact ? Rows3 : Columns3}
            title="Replace the picture with the full step table"
          >
            compact
          </Toggle>
        </div>

        {/* Fit is a button rather than the opening state: the canvas opens at
            a size the labels can be read at, and this is the way back out to
            the shape of the whole thing. */}
        <div className="seg">
          <button
            type="button"
            onClick={onFit}
            title="Fit the whole flow in the canvas"
            className="flex items-center gap-1.5"
          >
            <Maximize2 size={14} aria-hidden />
            fit
          </button>
        </div>
      </div>
    </div>
  );
}
