// The visual half of the taxonomy in src/lib/kinds.ts. One icon per kind,
// painted from a token, so nothing downstream picks its own glyph or colour.

import {
  ArrowRight,
  Diamond,
  Hexagon,
  HelpCircle,
  Route,
  ScrollText,
  Server,
  Shapes,
  Square,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Kind } from "../lib/kinds";
import { KIND_LABEL } from "../lib/kinds";
import { ctxStyle } from "../lib/context-color";

export const KIND_ICON: Record<Kind, LucideIcon> = {
  context: Hexagon, // unused: contexts draw a coloured dot instead
  service: Server,
  aggregate: Hexagon,
  event: Zap,
  vo: Diamond,
  entity: Square,
  command: ArrowRight,
  query: HelpCircle,
  def: Shapes,
  flow: Route,
  adr: ScrollText,
};

/**
 * Colour by kind. Domain events are the loudest leaf in the tree because they
 * are the thing other contexts actually depend on; structural blocks stay grey
 * so they read as detail inside the aggregate that owns them.
 */
export const KIND_COLOR: Record<Kind, string> = {
  context: "var(--ctx)",
  service: "var(--fg-muted)",
  aggregate: "var(--fg)",
  event: "var(--kind-event)",
  vo: "var(--fg-muted)",
  entity: "var(--fg-muted)",
  command: "var(--fg-muted)",
  query: "var(--fg-muted)",
  def: "var(--fg-muted)",
  flow: "var(--fg-muted)",
  adr: "var(--fg-muted)",
};

/** Kinds whose names are identifiers in the source, and so are set in mono. */
export const KIND_MONO: Record<Kind, boolean> = {
  context: true,
  service: true,
  aggregate: true,
  event: true,
  vo: true,
  entity: true,
  command: true,
  query: true,
  def: true,
  flow: true,
  adr: true,
};

export function KindIcon({
  kind,
  contextId,
  size = 11,
  className = "",
}: {
  kind: Kind;
  /** Required for `context`, which is painted in that context's own colour. */
  contextId?: string;
  size?: number;
  className?: string;
}) {
  if (kind === "context") {
    return (
      <span
        aria-hidden
        className={`inline-block shrink-0 rounded-full ${className}`}
        style={{
          width: size - 3,
          height: size - 3,
          background: "var(--ctx)",
          ...ctxStyle(contextId),
        }}
      />
    );
  }
  const Icon = KIND_ICON[kind];
  const filled = kind === "entity";
  return (
    <Icon
      size={size}
      aria-hidden
      className={`shrink-0 ${className}`}
      style={{ color: KIND_COLOR[kind], fill: filled ? "currentColor" : "none" }}
    />
  );
}

/** Icon plus the kind's name, for page headers and palette group rows. */
export function KindTag({
  kind,
  contextId,
}: {
  kind: Kind;
  contextId?: string;
}) {
  return (
    <span className="mono inline-flex items-center gap-1.5 text-muted">
      <KindIcon kind={kind} contextId={contextId} />
      {KIND_LABEL[kind]}
    </span>
  );
}
