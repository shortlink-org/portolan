// The canvas's own controls, floating over its top-left corner.
//
// They are here rather than in the page header because they act on the
// viewport, and a viewport control that sits outside the viewport it moves is
// a control the reader has to remember belongs to it.

import { useRef, useState } from "react";
import { Panel, useReactFlow } from "@xyflow/react";
import {
  Crosshair,
  FileCode2,
  ImageDown,
  Maximize2,
  Minus,
  Plus,
} from "lucide-react";
import { useToastStore } from "../app/toast";
import { saveCanvasImage, viewportOf } from "../lib/export-canvas";
import type { ImageKind } from "../lib/export-canvas";
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
          className={`flex items-center gap-1.5 ${focusing ? "is-on" : ""}`}
          title="Click a service to dim everything more than one hop away (Esc clears)"
        >
          <Crosshair size={13} aria-hidden />
          <span>{focused && focusing ? focusedLabel(focused) : "focus"}</span>
        </button>
      </div>

      <ExportSeg name={`dependency-graph-${mode}`} />
    </Panel>
  );
}

/**
 * The canvas as a picture: png for a slide, svg for a wiki.
 *
 * It finds its own viewport by walking up to the canvas it is floating over,
 * so it needs no ref from the page and sits in any React Flow toolbar the
 * same way. The file is named after the drawing and the catalog revision,
 * like every other export.
 */
export function ExportSeg({ name }: { name: string }) {
  const say = useToastStore((s) => s.say);
  const self = useRef<HTMLDivElement | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async (kind: ImageKind): Promise<void> => {
    const viewport = viewportOf(self.current?.closest(".react-flow"));
    if (!viewport) {
      say("the canvas is not on screen");
      return;
    }
    setSaving(true);
    try {
      const file = await saveCanvasImage(viewport, name, kind);
      say(`${kind.toUpperCase()} downloaded — ${file}`);
    } catch (cause) {
      say(
        `could not export ${kind.toUpperCase()}: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div ref={self} className="seg seg-float" role="group" aria-label="Export">
      <button
        type="button"
        onClick={() => void save("png")}
        disabled={saving}
        title="Save the canvas as a PNG"
        className="flex items-center gap-1.5"
      >
        <ImageDown size={13} aria-hidden />
        {saving ? "saving…" : "png"}
      </button>
      <button
        type="button"
        onClick={() => void save("svg")}
        disabled={saving}
        title="Save the canvas as an SVG"
        className="flex items-center gap-1.5"
      >
        <FileCode2 size={13} aria-hidden />
        svg
      </button>
    </div>
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
