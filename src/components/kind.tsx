// The visual half of the taxonomy in src/lib/kinds.ts. One icon per kind,
// painted from a token, so nothing downstream picks its own glyph or colour.

import {
  Database,
  Eye,
  Hexagon,
  Route,
  ScrollText,
  Server,
  Shapes,
  Table2,
  Webhook,
} from "lucide-react";
import type { Kind } from "../lib/kinds";
import { KIND_LABEL } from "../lib/kinds";
import { ctxStyle } from "../lib/context-color";
import {
  CommandIcon,
  EntityIcon,
  EventIcon,
  QueryIcon,
  ValueObjectIcon,
} from "./ddd-icons";

/**
 * Anything that takes `size` and paints itself from `currentColor` - lucide's
 * icons and portolan's own five, which are drawn on lucide's grid precisely so
 * this type can cover both.
 */
type IconComponent = (props: {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
  "aria-hidden"?: boolean;
}) => React.ReactNode;

/**
 * The five DDD building blocks are drawn in ./ddd-icons; everything else is
 * app chrome and stays lucide. That split is the rule, not a coincidence: a
 * domain concept gets a mark that says what it is, a piece of furniture gets
 * the furniture library.
 */
export const KIND_ICON: Record<Kind, IconComponent> = {
  context: Hexagon, // unused: contexts draw a coloured dot instead
  service: Server,
  aggregate: Hexagon,
  // A store and a table are infrastructure, not domain objects, so they take
  // lucide's furniture rather than one of portolan's five domain marks.
  store: Database,
  table: Table2,
  // A view is drawn as an eye rather than a second grid: what separates it
  // from a table is that it is a way of LOOKING at rows, not a place they are.
  view: Eye,
  event: EventIcon,
  vo: ValueObjectIcon,
  entity: EntityIcon,
  command: CommandIcon,
  query: QueryIcon,
  // An endpoint is a door in the wall of a service, not a domain object, so it
  // takes furniture like the store and the table do.
  endpoint: Webhook,
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
  store: "var(--fg-muted)",
  table: "var(--fg-muted)",
  view: "var(--fg-muted)",
  event: "var(--kind-event)",
  vo: "var(--fg-muted)",
  entity: "var(--fg-muted)",
  command: "var(--fg-muted)",
  query: "var(--fg-muted)",
  endpoint: "var(--fg-muted)",
  def: "var(--fg-muted)",
  flow: "var(--fg-muted)",
  adr: "var(--fg-muted)",
};

/** Kinds whose names are identifiers in the source, and so are set in mono. */
export const KIND_MONO: Record<Kind, boolean> = {
  context: true,
  service: true,
  aggregate: true,
  store: true,
  table: true,
  view: true,
  event: true,
  vo: true,
  entity: true,
  command: true,
  query: true,
  // An operationId is what a caller writes in code, and a verb-and-path is
  // what they write in a request. Both are identifiers.
  endpoint: true,
  def: true,
  flow: true,
  adr: true,
};

/**
 * Icons are 16px wherever one stands on its own - a toolbar button, a page
 * header, the panel's close. Inside a 12px mono row or chip the default drops
 * to 14: the icon labels the identifier next to it, and a 16px glyph beside
 * 12px type reads as the subject rather than the label.
 */
export function KindIcon({
  kind,
  contextId,
  size = 14,
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
  return (
    <Icon
      size={size}
      aria-hidden
      /* `block` drops the inline baseline gap so the glyph centres on the
         cap-height of the text beside it rather than sitting on its baseline. */
      className={`block shrink-0 ${className}`}
      style={{ color: KIND_COLOR[kind] }}
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
