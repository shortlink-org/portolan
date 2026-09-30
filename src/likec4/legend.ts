// What the marks on one C4 picture mean.
//
// The generator gives every box and arrow a colour, a shape, a border, a line
// and a head, and each of those carries a meaning. A picture has to say what
// they are, but only for the marks it actually draws: a legend listing the
// aggregate on the estate map explains nothing and hides what does matter.
// So the key is read off the layouted view itself, the same data LikeC4 paints
// from, and cannot drift from the picture on screen.

import { likec4model } from "./bundle";
import { abbreviationsIn } from "../lib/abbreviations";

export type Status = "verified" | "declared" | "unresolved";
export type Head = "normal" | "onormal" | "none";
export type BoxShape = "rectangle" | "storage" | "queue" | "person";

export interface BoxEntry {
  kind: string;
  name: string;
  note: string;
  shape: BoxShape;
  /** A context colour, or the neutral grey everything outside a context wears. */
  tone: "context" | "muted" | "unresolved" | "accent";
  dashed: boolean;
  /** Drawn as a faint frame around what it holds, rather than as a filled box. */
  frame?: boolean;
}

export interface ArrowEntry {
  key: string;
  name: string;
  note: string;
  head: Head;
  /** Ownership is not evidence; it is drawn in the neutral grey. */
  muted: boolean;
}

export interface EvidenceEntry {
  status: Status | "mixed";
  name: string;
  note: string;
}

export interface Legend {
  boxes: BoxEntry[];
  /** Context colour indexes the picture uses, in palette order. */
  contexts: number[];
  arrows: ArrowEntry[];
  evidence: EvidenceEntry[];
  /** Abbreviations in the picture's names and technologies, in order of first use. */
  abbreviations: string[];
}

// One entry per element and deployment-node kind in the generated
// specification, plus the instance LikeC4 draws inside a deployment node. The
// test checks the specification against it, so a new kind cannot go unexplained.
export const BOXES: Record<string, Omit<BoxEntry, "kind">> = {
  context: { name: "Bounded context", note: "A dashed boundary. Its colour marks everything inside it.", shape: "rectangle", tone: "context", dashed: true },
  service: { name: "Service", note: "A deployable container, in the colour of its context.", shape: "rectangle", tone: "context", dashed: false },
  aggregate: { name: "Aggregate", note: "A consistency boundary inside one service.", shape: "rectangle", tone: "context", dashed: false },
  event: { name: "Event", note: "A fact an aggregate publishes.", shape: "rectangle", tone: "context", dashed: false },
  store: { name: "Store", note: "A database a service keeps its state in.", shape: "storage", tone: "muted", dashed: false },
  broker: { name: "Broker", note: "A bus or queue that messages and jobs pass through.", shape: "queue", tone: "muted", dashed: false },
  actor: { name: "Actor", note: "A person or schedule outside the estate that starts a flow.", shape: "person", tone: "muted", dashed: false },
  external: { name: "External system", note: "Outside the estate, and known to be.", shape: "rectangle", tone: "muted", dashed: false },
  unknown: { name: "Not in the catalog", note: "Named by a call, but no service in the catalog answers to it.", shape: "rectangle", tone: "unresolved", dashed: true },
  environment: { name: "Environment", note: "Where a release runs, such as prod or staging.", shape: "rectangle", tone: "accent", dashed: true },
  cluster: { name: "Cluster", note: "A cluster inside the environment.", shape: "rectangle", tone: "muted", dashed: true },
  namespace: { name: "Namespace", note: "A namespace inside the cluster.", shape: "rectangle", tone: "muted", dashed: false },
  instance: { name: "Running service", note: "A deployed copy of a service, in the colour of its context.", shape: "rectangle", tone: "context", dashed: false },
};

// Arrows are explained by what they relate, because the same head means the
// same direction for all of them: from the one that acts to what it acts on.
const ARROWS: Record<string, Omit<ArrowEntry, "key" | "head">> = {
  "calls:normal": { name: "Call", note: "From caller to callee; the protocol is in brackets.", muted: false },
  "uses:normal": { name: "Uses", note: "Where an actor reaches the estate.", muted: false },
  "reads:normal": { name: "Reads", note: "A service reading a store another service owns.", muted: false },
  "persists:normal": { name: "Persists", note: "From an aggregate to the store its tables are in.", muted: false },
  "depends_on:normal": { name: "Depends on", note: "A dependency declared in the manifest.", muted: false },
  "publishes_to:onormal": { name: "Event", note: "From the publisher to a service that consumes it.", muted: false },
  "bus:onormal": { name: "Through a broker", note: "An event or a job: sent onto the broker, delivered off it to the receiver.", muted: false },
  "owns:none": { name: "Owns", note: "The service keeps its state in this store.", muted: true },
};

// LikeC4 folds relations of different kinds into one edge on the estate map
// and drops the kind; the head still says what sort of arrow it is.
const FOLDED: Record<Head, Omit<ArrowEntry, "key" | "head">> = {
  normal: { name: "Call or use", note: "Several relations folded into one arrow, from the one that acts.", muted: false },
  onormal: { name: "Event", note: "From the publisher to whoever hears it.", muted: false },
  none: { name: "Association", note: "No direction is claimed.", muted: false },
};

const EVIDENCE: Record<EvidenceEntry["status"], Omit<EvidenceEntry, "status">> = {
  verified: { name: "Verified", note: "Solid: observed at runtime." },
  declared: { name: "Declared", note: "Dashed: read off code or a contract, not observed." },
  unresolved: { name: "Unresolved", note: "Dotted: the other end is not in the catalog." },
  mixed: { name: "Mixed evidence", note: "Grey: relations with different evidence folded into one arrow." },
};

const ARROW_ORDER = [...Object.keys(ARROWS), "folded:normal", "folded:onormal", "folded:none"];
const HEADS = new Set<string>(["normal", "onormal", "none"]);
const STATUS_ORDER: EvidenceEntry["status"][] = ["verified", "declared", "unresolved", "mixed"];

interface NodeLike {
  kind: string;
  color: string;
  children?: readonly unknown[];
  title?: string | null;
  technology?: string | null;
}

interface EdgeLike {
  kind?: string | null;
  color?: string | null;
  head?: string | null;
  technology?: string | null;
}

/** Only the entries a picture with these nodes and edges needs. */
export function legendFrom(nodes: readonly NodeLike[], edges: readonly EdgeLike[]): Legend {
  const kinds = new Set(nodes.map((n) => n.kind));
  // A box LikeC4 draws with its children inside is a faint frame; the same kind
  // with nothing opened inside it is a filled box, and the key has to match.
  const frames = new Set(nodes.filter((n) => n.children?.length).map((n) => n.kind));
  const boxes = Object.entries(BOXES)
    .filter(([kind]) => kinds.has(kind))
    // LikeC4 draws a frame's border dashed unless told otherwise.
    .map(([kind, entry]) => ({ kind, ...entry, frame: frames.has(kind), dashed: entry.dashed || frames.has(kind) }));

  const contexts = [...new Set(nodes.flatMap((n) => {
    const match = /^ctx(\d+)$/.exec(n.color);
    return match ? [Number(match[1])] : [];
  }))].sort((a, b) => a - b);

  const arrows = new Map<string, ArrowEntry>();
  const statuses = new Set<EvidenceEntry["status"]>();
  for (const edge of edges) {
    const head = (HEADS.has(edge.head ?? "") ? edge.head : "normal") as Head;
    const key = `${edge.kind ?? ""}:${head}`;
    const entry = ARROWS[key] ?? FOLDED[head];
    const shown = ARROWS[key] ? key : `folded:${head}`;
    if (!arrows.has(shown)) arrows.set(shown, { key: shown, head, ...entry });

    const color = edge.color ?? "";
    if (color === "verified" || color === "declared" || color === "unresolved") statuses.add(color);
    else if (color !== "muted") statuses.add("mixed");
  }

  const words = [
    ...nodes.flatMap((n) => [n.title ?? "", n.technology ?? ""]),
    ...edges.map((e) => e.technology ?? ""),
  ].join(" \n ");

  return {
    boxes,
    contexts,
    abbreviations: abbreviationsIn(words),
    // Table order, not the order the edges happen to arrive in: the same key
    // should read the same way on every picture.
    arrows: [...arrows.values()].sort((a, b) => ARROW_ORDER.indexOf(a.key) - ARROW_ORDER.indexOf(b.key)),
    evidence: STATUS_ORDER.filter((s) => statuses.has(s)).map((status) => ({ status, ...EVIDENCE[status] })),
  };
}

const legends = new Map<string, Legend | null>();

/** The key for a generated view, or null when the bundle has no such view. */
export function viewLegend(viewId: string): Legend | null {
  if (legends.has(viewId)) return legends.get(viewId)!;
  const view = likec4model.findView(viewId)?.$layouted;
  const legend = view ? legendFrom(view.nodes, view.edges) : null;
  legends.set(viewId, legend);
  return legend;
}
