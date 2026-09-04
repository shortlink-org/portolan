// The dependency graph's two node kinds.
//
// A service is a card and an event is a pill, and the difference in
// silhouette is doing most of the work: a reader scanning the canvas can tell
// which of the two rows they are looking at without reading a word of either.

import { createContext, useContext } from "react";
import { Handle, Position } from "@xyflow/react";
import type { Node, NodeProps } from "@xyflow/react";
import { Server, Zap } from "lucide-react";
import { contextVar } from "../lib/context-color";
import { EVENT_ICON_W } from "./theme";

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

export function ServiceNode({ data }: NodeProps<ServiceNodeType>) {
  const accent = data.ghost ? "var(--status-unresolved)" : contextVar(data.context);

  return (
    <div
      className={`flex h-full w-full items-center gap-2 px-2.5 ${
        data.ghost ? "flow-card-ghost" : "flow-card"
      }`}
      style={{ color: data.ghost ? "var(--status-unresolved)" : "var(--fg)" }}
      title={data.ghost ? `${data.label} — not in the catalog` : data.label}
    >
      <span className="flow-tile" style={{ color: accent }}>
        <Server size={12} aria-hidden />
      </span>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
        <span className="mono truncate" style={{ fontSize: 11, lineHeight: 1.3 }}>
          {data.label}
        </span>
        {data.ghost ? (
          <span className="truncate" style={{ fontSize: 10, opacity: 0.8 }}>
            not in catalog
          </span>
        ) : (
          /* Two numbers, one line: what it emits and what it listens to. The
             arrows carry the direction so the words do not have to shout it. */
          <span
            className="tnum truncate text-muted"
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

/**
 * The pill. A tinted badge in the publisher's colour, the way a status badge
 * is tinted: the tint is the context, the bolt is the kind, and neither needs
 * a border to say so. Selection draws its own ring here because the pill is
 * not the shape of its box - see the rule on `.react-flow__node.selected`.
 */
export function EventNode({ data, selected }: NodeProps<EventNodeType>) {
  const accent = contextVar(data.context);
  const tiny = useContext(TinyZoom);

  return (
    <div className="flex h-full w-full items-center">
      <div
        className="flex h-full items-center gap-1.5 overflow-hidden px-2"
        style={{
          width: tiny ? EVENT_ICON_W : "100%",
          background: `color-mix(in srgb, ${accent} 10%, var(--flow-card))`,
          // A pill, not a box: the shape is the kind.
          borderRadius: 999,
          boxShadow: selected ? "var(--ring)" : "var(--shadow-card)",
          justifyContent: tiny ? "center" : undefined,
          paddingInline: tiny ? 0 : undefined,
          transition: "box-shadow var(--dur-micro) var(--ease-out)",
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
                className="ml-auto shrink-0 rounded-full px-1.5"
                style={{
                  fontSize: 9,
                  lineHeight: "14px",
                  fontWeight: 600,
                  background: `color-mix(in srgb, ${accent} 16%, transparent)`,
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
