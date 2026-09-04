// The canvas's own controls, floating over its top-left corner.
//
// They are here rather than in the page header because they act on the
// viewport, and a viewport control that sits outside the viewport it moves is
// a control the reader has to remember belongs to it.

import { Panel, useReactFlow } from "@xyflow/react";
import { Crosshair, Maximize2, Minus, Plus } from "lucide-react";
import type { GraphMode } from "./dependency-layout";

export const FIT_OPTIONS = { padding: 0.15, maxZoom: 1.25 } as const;

export function GraphToolbar({
  mode,
  onMode,
  focusing,
  onFocusing,
  focused,
}: {
  mode: GraphMode;
  onMode: (mode: GraphMode) => void;
  /** Focus mode is armed: the next service clicked becomes the subject. */
  focusing: boolean;
  onFocusing: (on: boolean) => void;
  /** The service currently focused, or null. */
  focused: string | null;
}) {
  return (
    <Panel position="top-left" className="flex flex-wrap items-center gap-2">
      <div className="seg seg-float" role="group" aria-label="Graph mode">
        <button
          type="button"
          onClick={() => onMode("bipartite")}
          aria-pressed={mode === "bipartite"}
          className={mode === "bipartite" ? "is-on" : undefined}
          title="Events as nodes"
        >
          events
        </button>
        <button
          type="button"
          onClick={() => onMode("compact")}
          aria-pressed={mode === "compact"}
          className={mode === "compact" ? "is-on" : undefined}
          title="Services only, one bundled edge per pair"
        >
          compact
        </button>
      </div>

      <ViewportSeg />

      <div className="seg seg-float">
        <button
          type="button"
          onClick={() => onFocusing(!focusing)}
          aria-pressed={focusing}
          className={focusing ? "is-on" : undefined}
          title="Click a service to dim everything more than one hop away (Esc clears)"
        >
          <Crosshair size={13} aria-hidden />
          <span className="ml-1.5">
            {focused && focusing ? focusedLabel(focused) : "focus"}
          </span>
        </button>
      </div>
    </Panel>
  );
}

/**
 * Fit, out, in - the three viewport controls, as one segment.
 *
 * It lives apart from the toolbar because it is the only part of it that is
 * about the canvas rather than about the graph, and every canvas has a
 * viewport: the focused event graph wears this on its own, with none of the
 * mode switches around it.
 */
export function ViewportSeg() {
  const flow = useReactFlow();

  return (
    <div className="seg seg-float" role="group" aria-label="Viewport">
      <button
        type="button"
        onClick={() => void flow.fitView(FIT_OPTIONS)}
        title="Fit to view"
        aria-label="Fit to view"
      >
        <Maximize2 size={13} aria-hidden />
      </button>
      <button
        type="button"
        onClick={() => void flow.zoomOut()}
        title="Zoom out"
        aria-label="Zoom out"
      >
        <Minus size={13} aria-hidden />
      </button>
      <button
        type="button"
        onClick={() => void flow.zoomIn()}
        title="Zoom in"
        aria-label="Zoom in"
      >
        <Plus size={13} aria-hidden />
      </button>
    </div>
  );
}

/** The last segment of a service id: the toolbar has no room for the context. */
function focusedLabel(serviceId: string): string {
  const at = serviceId.lastIndexOf(".");
  return at < 0 ? serviceId : serviceId.slice(at + 1);
}
