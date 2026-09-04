import { Handle, Position } from "@xyflow/react";
import type { NodeProps, Node } from "@xyflow/react";
import { Server } from "lucide-react";
import { EventIcon } from "../components/ddd-icons";
import { contextVar } from "../lib/context-color";

export type ServiceNodeData = {
  label: string;
  context: string | null;
  ghost: boolean;
  kind: "service" | "event" | "producer" | "context";
  /**
   * What this node is to the graph it is in - "publisher", "consumer". The
   * kind says what an entity IS; the role says why it is on this canvas, and
   * on a picture of one event that is the more useful of the two.
   */
  role?: string;
  /** Second line, on the nodes big enough to hold one. */
  sub?: string;
  /** Right-aligned tag - a context's classification, and nothing else so far. */
  tag?: string;
};

export type PortolanNode = Node<ServiceNodeData, "portolan">;

/** Fallback when a graph does not name the role itself. */
const ROLE: Record<ServiceNodeData["kind"], string> = {
  producer: "publisher",
  event: "event",
  service: "service",
  context: "context",
};

/**
 * The node the focused event graph draws. (The dependency graph and the
 * context map register their own components under the same `portolan` key,
 * so this one is not shared - it used to be, and the comment saying so
 * outlived the split.)
 *
 * A card: an icon in a tinted tile, and beside it two lines. The eyebrow says
 * outright what the box is - publisher, event, consumer - so a reader does
 * not have to work it out from position, and it takes the colour, which
 * leaves the name under it plain and readable. The tile is where the card
 * keeps the colour of the context that owns it; it used to be a bar down the
 * left edge and a wash across the box, and on a canvas of cards a wash is
 * the one thing that stops a card being a card.
 */
export function PortolanNode({ data }: NodeProps<PortolanNode>) {
  const accent = data.ghost
    ? "var(--status-unresolved)"
    : data.kind === "event"
      ? // An event is amber everywhere else in the app; it was blue here only
        // because blue is what --accent happened to be.
        "var(--kind-event)"
      : contextVar(data.context);
  const Icon = data.kind === "event" ? EventIcon : Server;
  // A node the catalog does not know is not a publisher or a consumer - it is
  // a name someone wrote down, and the eyebrow is where that is said.
  const eyebrow = data.ghost
    ? "not in catalog"
    : (data.role ?? ROLE[data.kind]);

  return (
    <div
      className={`flex h-full w-full items-center gap-2 px-2.5 ${
        data.ghost ? "flow-card-ghost" : "flow-card"
      }`}
      style={{ color: data.ghost ? "var(--status-unresolved)" : "var(--fg)" }}
      title={data.ghost ? `${data.label} — not in the catalog` : data.label}
    >
      <span className="flow-tile" style={{ color: accent }}>
        <Icon size={12} aria-hidden />
      </span>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-px">
        <span
          className="truncate uppercase"
          style={{
            color: accent,
            fontSize: 9,
            lineHeight: 1.3,
            letterSpacing: "0.06em",
            fontWeight: 600,
          }}
        >
          {eyebrow}
        </span>
        <span className="mono truncate" style={{ fontSize: 12, lineHeight: 1.3 }}>
          {data.label}
        </span>
      </div>
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </div>
  );
}

export const nodeTypes = { portolan: PortolanNode };
