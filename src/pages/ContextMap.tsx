// The context map.
//
// The one view in the app that is about the SPACE BETWEEN the domains rather
// than about anything inside one. Everywhere else, a context is a folder you
// open; here it is a party to a relationship, and the relationship is the
// subject.
//
// Two halves, and the split is deliberate. The diagram says the shape - who
// leans on whom, and how hard. The list says the patterns, in the words DDD
// already has for them, with the evidence each was read from directly under
// it. A pattern chip that could not be checked would be an opinion in a tool
// whose whole claim is that it does not hold opinions.

import { useMemo } from "react";
import { Link } from "react-router";
import { ArrowRight, ArrowLeftRight, Boxes, Minus } from "lucide-react";
import { catalog } from "../data";
import { plural } from "../lib/format";
import { PATTERN_LABEL, PATTERN_MEANING, contextMap } from "../lib/context-map";
import type {
  ContextDependency,
  ContextRelation,
  MapLink,
  MapPattern,
  SharedKernel,
} from "../lib/context-map";
import type { Status } from "../catalog";
import { EventIcon } from "../components/ddd-icons";
import { contextName, ctxStyle } from "../lib/context-color";
import { staggerStyle } from "../lib/motion";
import { statusVar } from "../components/primitives";
import { Empty, SectionTitle } from "../components/PageHeader";
import { Ident } from "../components/Ident";
import { Toc } from "../components/Toc";
import type { TocItem } from "../components/Toc";
import { ContextMapPane } from "../map/ContextMapGraph";
import {
  MAP_ANCHOR,
  blockPath,
  eventPath,
  paths,
  relationAnchor,
} from "../routes";

const TOC: TocItem[] = [
  { id: MAP_ANCHOR.model, label: "Map" },
  { id: MAP_ANCHOR.relations, label: "Relationships" },
];

/**
 * A pattern, said in one word.
 *
 * Counted patterns get a solid border and read ones a dashed border, which is
 * the same distinction the whole app already draws between what was observed
 * and what was only declared. A reader who knows what a dashed edge means on
 * the dependency graph knows what a dashed chip means here.
 */
function PatternChip({ pattern }: { pattern: MapPattern }) {
  const read = pattern.basis === "read";
  return (
    <span
      className="chip"
      style={{
        borderStyle: read ? "dashed" : "solid",
        borderColor: read ? "var(--border-strong)" : "var(--accent)",
        color: read ? "var(--fg-muted)" : "var(--accent)",
      }}
      title={`${PATTERN_MEANING[pattern.name]}\n\n${
        read
          ? "READ from what the shapes name — a question for the team, not a fact the catalog stated."
          : "COUNTED from the graph — it cannot be otherwise."
      }\n\n${pattern.why}`}
    >
      {PATTERN_LABEL[pattern.name]}
      {read ? <span style={{ opacity: 0.7 }}>· read</span> : null}
    </span>
  );
}

function ContextLink({ id }: { id: string }) {
  return (
    <Link
      to={paths.context(id)}
      className="chip ctx"
      style={ctxStyle(id)}
      title={contextName(id)}
    >
      <span aria-hidden className="dot" />
      {id}
    </Link>
  );
}

/** How many links share one id - two callers of one method are one chip with a count. */
interface Grouped {
  link: MapLink;
  /** The downstream services taking it, one per link folded in. */
  takers: string[];
}

function groupLinks(links: readonly MapLink[]): Grouped[] {
  const out: Grouped[] = [];
  for (const link of links) {
    const seen = out.find((g) => g.link.id === link.id);
    if (seen) seen.takers.push(link.to);
    else out.push({ link, takers: [link.to] });
  }
  return out;
}

/** "2 events · 1 call" - a count that is zero is not said. */
function counts(links: readonly MapLink[]): string {
  const events = links.filter((l) => l.kind === "event").length;
  const calls = links.length - events;
  const parts: string[] = [];
  if (events > 0) parts.push(`${events} ${plural(events, "event")}`);
  if (calls > 0) parts.push(`${calls} ${plural(calls, "call")}`);
  return parts.join(" · ");
}

/** The status square every link carries, in the app's three colours. */
function StatusMark({ status }: { status: Status }) {
  return (
    <span
      aria-hidden
      className="size-1.5 shrink-0 rounded-[1px]"
      style={{ background: statusVar(status) }}
    />
  );
}

/** A small right-hand count on a chip that stands for more than one link. */
function Times({ n }: { n: number }) {
  if (n < 2) return null;
  return <span className="tnum opacity-70">×{n}</span>;
}

/**
 * An event, as a tinted pill - the same paint the dependency graph gives an
 * event, so a reader knows the kind before reading the name. Calls stay
 * outlined: two kinds of link, two shapes, and the eye sorts them without
 * being asked to.
 */
function EventChip({ group }: { group: Grouped }) {
  const { link, takers } = group;
  const to = eventPath(link.id);
  const title = `${link.id} — ${link.from} → ${takers.join(", ")} (${link.status})`;
  const body = (
    <>
      <EventIcon size={11} aria-hidden />
      <StatusMark status={link.status} />
      {link.label}
      <Times n={takers.length} />
    </>
  );
  const style = {
    color: "var(--kind-event)",
    background: "color-mix(in srgb, var(--kind-event) 12%, transparent)",
    borderColor: "transparent",
  };
  return to ? (
    <Link to={to} className="chip" style={style} title={title}>
      {body}
    </Link>
  ) : (
    <span className="chip" style={style} title={title}>
      {body}
    </span>
  );
}

function CallChip({ group }: { group: Grouped }) {
  const { link, takers } = group;
  return (
    <Ident
      value={link.id}
      className="chip border-line-strong text-muted"
      title={`${link.id} — ${takers.join(", ")} ${takers.length === 1 ? "calls" : "call"} ${link.from} (${link.status})`}
    >
      <StatusMark status={link.status} />
      {link.id}
      <Times n={takers.length} />
    </Ident>
  );
}

/**
 * Everything taken in one direction, with each thing linked to where it lives.
 *
 * The pair is already in the card's title, so a one-way card does not spell it
 * again: the eyebrow says who takes, the count says how much, and the chips
 * say what. A partnership has two of these, and only there does the eyebrow
 * name the other side - that is the line a reader is telling apart.
 */
function Dependency({
  dependency,
  named,
}: {
  dependency: ContextDependency;
  /** Say the upstream in the eyebrow - needed when the card holds two directions. */
  named: boolean;
}) {
  const groups = groupLinks(dependency.links);
  const events = groups.filter((g) => g.link.kind === "event");
  const calls = groups.filter((g) => g.link.kind === "rpc");

  return (
    <div className="mt-3">
      <div className="flex items-baseline gap-2">
        <span className="label">
          {dependency.downstream} takes
          {named ? ` from ${dependency.upstream}` : ""}
        </span>
        <span className="mono ml-auto shrink-0 text-faint">
          {counts(dependency.links)}
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {events.map((group) => (
          <EventChip key={group.link.id} group={group} />
        ))}
        {calls.map((group) => (
          <CallChip key={group.link.id} group={group} />
        ))}
      </div>
    </div>
  );
}

/**
 * A block's name and the aggregate holding it: `order.money`.
 *
 * The last segment alone is what a kernel row would otherwise be made of, and
 * a row reading "money money money money" is a row that has counted something
 * without saying anything. Which aggregates hold the shared type IS the fact.
 */
function shapeName(blockId: string): string {
  return blockId.split(".").slice(-2).join(".");
}

/** How many shapes a side lists before the rest become a count. */
const SHAPES_SHOWN = 4;

function KernelSide({ side, blocks }: { side: string; blocks: string[] }) {
  const shown = blocks.slice(0, SHAPES_SHOWN);
  const rest = blocks.length - shown.length;
  return (
    <span
      className="flex min-w-0 flex-wrap items-baseline gap-1.5"
      style={ctxStyle(side)}
    >
      <span className="ctx shrink-0">{side}</span>
      {shown.map((blockId) => {
        const to = blockPath(blockId);
        return to ? (
          <Link
            key={blockId}
            to={to}
            className="rounded-control text-accent hover:underline"
            title={blockId}
          >
            {shapeName(blockId)}
          </Link>
        ) : (
          <span key={blockId} className="text-muted" title={blockId}>
            {shapeName(blockId)}
          </span>
        );
      })}
      {rest > 0 ? (
        <span
          className="text-muted"
          title={blocks.slice(SHAPES_SHOWN).join("\n")}
        >
          +{rest}
        </span>
      ) : null}
    </span>
  );
}

/** The types both sides name, and which shapes name them. */
function Kernel({
  shared,
  a,
  b,
}: {
  shared: SharedKernel[];
  a: string;
  b: string;
}) {
  return (
    <div className="mt-3">
      <div className="label mb-1">Shared kernel</div>
      <div className="flex flex-col gap-1.5">
        {shared.map((entry) => (
          <div key={entry.def} className="mono flex flex-wrap gap-x-4 gap-y-1">
            <span className="flex w-28 shrink-0 items-center gap-1 text-ink">
              <Boxes size={12} aria-hidden className="text-muted" />
              {entry.def}
            </span>
            {[a, b].map((side) => (
              <KernelSide
                key={side}
                side={side}
                blocks={entry.blocks[side] ?? []}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * A counted reason ends in the numbers it was counted from - "storefront takes
 * 6 calls from shop" - and on the card those numbers are already the eyebrow
 * and the count under it. So the sentence stops at the dash. A read reason
 * keeps its tail: nothing under it says the same thing twice, and the tail is
 * the whole of its evidence.
 */
function whyShown(pattern: MapPattern): string {
  if (pattern.basis !== "counted") return pattern.why;
  const cut = pattern.why.indexOf(" — ");
  return cut < 0 ? pattern.why : pattern.why.slice(0, cut);
}

function Relation({ relation, at }: { relation: ContextRelation; at: number }) {
  const both = relation.dependencies.length === 2;
  const one = relation.dependencies.length === 1;
  const Glyph = both ? ArrowLeftRight : one ? ArrowRight : Minus;

  // A one-way pair reads left to right: supplier first, customer second. The
  // catalog's own order is only a tie-break, and following it here would draw
  // half the arrows backwards.
  const left = one
    ? (relation.dependencies[0]?.upstream ?? relation.a)
    : relation.a;
  const right = left === relation.a ? relation.b : relation.a;

  return (
    <section
      id={relationAnchor(relation.id)}
      className="card card-static stagger-in scroll-mt-4"
      style={staggerStyle(at)}
    >
      <div className="flex flex-wrap items-center gap-2">
        <ContextLink id={left} />
        <Glyph size={14} aria-hidden className="text-muted" />
        <ContextLink id={right} />
        <span className="ml-auto flex flex-wrap items-center gap-1">
          {relation.patterns.map((pattern) => (
            <PatternChip
              key={`${pattern.name}:${pattern.downstream ?? ""}`}
              pattern={pattern}
            />
          ))}
        </span>
      </div>

      {/* Every chip's reason, spelled out. The chip is the word; this is the
          measurement it was read from, and it is what makes the word
          checkable. Prose, not a list: it is a sentence about the pair, and
          only when there are several does each get the word it explains. */}
      <div className="mt-2 flex flex-col gap-0.5 text-muted">
        {relation.patterns.map((pattern) => (
          <p key={`why:${pattern.name}:${pattern.downstream ?? ""}`}>
            {relation.patterns.length > 1 ? (
              <span className="label mr-2">{PATTERN_LABEL[pattern.name]}</span>
            ) : null}
            {whyShown(pattern)}
          </p>
        ))}
      </div>

      {relation.dependencies.length > 0 || relation.shared.length > 0 ? (
        <div className="mt-3 border-t border-line">
          {relation.dependencies.map((dependency) => (
            <Dependency
              key={`${dependency.upstream}->${dependency.downstream}`}
              dependency={dependency}
              named={both}
            />
          ))}
          {relation.shared.length > 0 ? (
            <Kernel shared={relation.shared} a={relation.a} b={relation.b} />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/**
 * The pairs nothing joins, in one card. A finding each, but the same finding,
 * and three cards saying "nothing" weigh the same on the page as a
 * partnership does - so they share one, and keep their anchors inside it.
 */
function SeparateWays({
  relations,
  at,
}: {
  relations: readonly ContextRelation[];
  at: number;
}) {
  const why = relations[0]?.patterns[0]?.why ?? "";
  return (
    <section
      className="card card-static stagger-in scroll-mt-4"
      style={staggerStyle(at)}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="label">
          {PATTERN_LABEL["separate-ways"]} · {relations.length}{" "}
          {plural(relations.length, "pair")}
        </span>
        <span className="mono ml-auto text-faint">{why}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
        {relations.map((relation) => (
          <span
            key={relation.id}
            id={relationAnchor(relation.id)}
            className="flex items-center gap-2 scroll-mt-4"
          >
            <ContextLink id={relation.a} />
            <Minus size={14} aria-hidden className="text-muted" />
            <ContextLink id={relation.b} />
          </span>
        ))}
      </div>
    </section>
  );
}

export function ContextMap() {
  const relations = useMemo(() => contextMap(catalog), []);
  const joined = relations.filter(
    (r) => r.dependencies.length > 0 || r.shared.length > 0,
  );
  const apart = relations.filter((r) => !joined.includes(r));
  const wired = joined.length;

  return (
    <div className="h-full overflow-y-auto">
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b px-gutter py-3 border-line">
        <h1 className="text-lg font-semibold">Context map</h1>
        <span className="mono text-muted">
          {catalog.contexts.length} {plural(catalog.contexts.length, "domain")} ·{" "}
          {wired} of {relations.length} {plural(relations.length, "pair")} joined
        </span>

        {/* Two legends, and they answer different questions: what the arrow
            means, and how far a word on a chip can be trusted. */}
        <div className="mono ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-muted">
          <span
            className="flex items-center gap-1.5"
            title="The arrow points the way a dependency runs: from the model that is depended on to the one that depends on it."
          >
            <ArrowRight size={12} aria-hidden />
            upstream → downstream
          </span>
          <span
            className="chip"
            style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
            title="Follows from the graph. It cannot be otherwise."
          >
            counted
          </span>
          <span
            className="chip border-line-strong"
            style={{ borderStyle: "dashed" }}
            title="Read off what the shapes on each side name. A question worth asking the team, not a fact the catalog stated."
          >
            read
          </span>
        </div>
      </div>

      <div className="flex gap-section p-gutter">
        <div className="min-w-0 flex-1">
          <section id={MAP_ANCHOR.model}>
            <SectionTitle
              anchor={MAP_ANCHOR.model}
              right={
                <span>
                  click a domain to light what it is on · double-click to open
                  it
                </span>
              }
            >
              Map
            </SectionTitle>
            <div className="h-[340px] overflow-hidden rounded-card border border-line">
              <ContextMapPane catalog={catalog} relations={relations} />
            </div>
          </section>

          <section id={MAP_ANCHOR.relations} className="mt-section max-w-table">
            <SectionTitle
              anchor={MAP_ANCHOR.relations}
              right={
                <span>
                  the pairs that are wired together first
                </span>
              }
            >
              Relationships
            </SectionTitle>
            {relations.length === 0 ? (
              <Empty>
                one domain has no neighbours — a map needs two to draw a line
              </Empty>
            ) : (
              <div className="flex flex-col gap-grid">
                {joined.map((relation, i) => (
                  <Relation key={relation.id} relation={relation} at={i} />
                ))}
                {apart.length > 0 ? (
                  <SeparateWays relations={apart} at={joined.length} />
                ) : null}
              </div>
            )}
          </section>
        </div>

        <Toc items={TOC} label="Sections of the context map" />
      </div>
    </div>
  );
}
