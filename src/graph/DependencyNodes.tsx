// The dependency graph's two node kinds.
//
// A service is a box and an event is a pill, and the difference in silhouette
// is doing most of the work: a reader scanning the canvas can tell which of
// the two rows they are looking at without reading a word of either.

import { createContext, useContext } from "react";
import { Handle, Position } from "@xyflow/react";
import type { Node, NodeProps } from "@xyflow/react";
import { Zap } from "lucide-react";
import { contextVar } from "../lib/context-color";
import { EVENT_ICON_W, NODE_RADIUS } from "./theme";

/**
 * True when the viewport is zoomed out past the point where an 11px label is
 * a word. It is a context rather than node data so that crossing the threshold
 * re-renders the pills without rebuilding every node object - and it is a
 * boolean rather than the zoom, so a pinch that stays on one side of the line
 * costs nothing at all.
 */
export const TinyZoom = createContext(false);

export interface ServiceNodeData {
  kind: "service";
  label: string;
  context: string | null;
  ghost: boolean;
  publishes: number;
  consumes: number;
  [key: string]: unknown;
}

export interface EventNodeData {
  kind: "event";
  label: string;
  /** the publishing service's context; the pill borrows its colour */
  context: string | null;
  eventId: string;
  publisher: string;
  /** the publisher consumes it too */
  self: boolean;
  [key: string]: unknown;
}

export type ServiceNodeType = Node<ServiceNodeData, "service">;
export type EventNodeType = Node<EventNodeData, "event">;
export type DependencyNode = ServiceNodeType | EventNodeType;

const HANDLE = { opacity: 0, width: 1, height: 1 } as const;

export function ServiceNode({ data, selected }: NodeProps<ServiceNodeType>) {
  const accent = data.ghost ? "var(--status-unresolved)" : contextVar(data.context);

  return (
    <div
      className="flex h-full w-full items-stretch overflow-hidden"
      style={{
        background: "var(--surface)",
        border: `1px ${data.ghost ? "dashed" : "solid"} ${accent}`,
        borderRadius: NODE_RADIUS,
        color: data.ghost ? "var(--status-unresolved)" : "var(--fg)",
        outline: selected ? "1px solid var(--accent)" : undefined,
        outlineOffset: 1,
      }}
      title={data.ghost ? `${data.label} — not in the catalog` : data.label}
    >
      <span aria-hidden className="w-[3px] shrink-0" style={{ background: accent }} />
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 px-2.5">
        <span className="mono truncate" style={{ fontSize: 11, lineHeight: 1.3 }}>
          {data.label}
        </span>
        {data.ghost ? (
          <span className="mono truncate" style={{ fontSize: 10, opacity: 0.8 }}>
            not in catalog
          </span>
        ) : (
          /* Two numbers, one line: what it emits and what it listens to. The
             arrows carry the direction so the words do not have to shout it. */
          <span
            className="mono truncate text-muted"
            style={{ fontSize: 10, lineHeight: 1.4 }}
          >
            ↑{data.publishes} publishes · ↓{data.consumes} consumes
          </span>
        )}
      </div>
      <Handle type="target" position={Position.Left} style={HANDLE} />
      <Handle type="source" position={Position.Right} style={HANDLE} />
    </div>
  );
}

export function EventNode({ data, selected }: NodeProps<EventNodeType>) {
  const accent = contextVar(data.context);
  const tiny = useContext(TinyZoom);

  return (
    <div className="flex h-full w-full items-center">
      <div
        className="flex h-full items-center gap-1.5 overflow-hidden px-2"
        style={{
          width: tiny ? EVENT_ICON_W : "100%",
          background: "var(--surface-2)",
          border: `1px solid ${accent}`,
          // A pill, not a box: the shape is the kind.
          borderRadius: 999,
          outline: selected ? "1px solid var(--accent)" : undefined,
          outlineOffset: 1,
          justifyContent: tiny ? "center" : undefined,
          paddingInline: tiny ? 0 : undefined,
        }}
        title={
          data.self
            ? `${data.label} — published and consumed by ${data.publisher}`
            : `${data.label} — published by ${data.publisher}`
        }
      >
        <Zap
          size={11}
          aria-hidden
          className="shrink-0"
          style={{ color: accent }}
          fill="currentColor"
        />
        {tiny ? null : (
          <>
            <span
              className="mono truncate"
              style={{ fontSize: 11, lineHeight: 1.2, color: "var(--fg)" }}
            >
              {data.label}
            </span>
            {/* A service listening to its own event is a fact about the pill,
                not a line: a loop edge would have to circle the node it leaves
                and arrives at, and there is nothing between the two ends of it
                for a reader to follow. */}
            {data.self ? (
              <span
                className="mono ml-auto shrink-0 rounded-full border px-1"
                style={{
                  fontSize: 9,
                  lineHeight: "13px",
                  borderColor: accent,
                  color: accent,
                }}
              >
                self
              </span>
            ) : null}
          </>
        )}
      </div>
      <Handle type="target" position={Position.Left} style={HANDLE} />
      <Handle type="source" position={Position.Right} style={HANDLE} />
    </div>
  );
}

export const dependencyNodeTypes = { service: ServiceNode, event: EventNode };
