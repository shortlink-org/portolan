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
  MapPattern,
  SharedKernel,
} from "../lib/context-map";
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

/** Everything taken in one direction, with each thing linked to where it lives. */
function Dependency({ dependency }: { dependency: ContextDependency }) {
  const events = dependency.links.filter((l) => l.kind === "event");
  const calls = dependency.links.filter((l) => l.kind === "rpc");

  return (
    <div className="mt-2">
      <div className="mono flex flex-wrap items-center gap-1.5 text-muted">
        <ContextLink id={dependency.upstream} />
        <ArrowRight size={12} aria-hidden />
        <ContextLink id={dependency.downstream} />
        <span className="ml-1">
          {dependency.downstream} takes {events.length}{" "}
          {events.length === 1 ? "event" : "events"}
          {calls.length > 0
            ? ` and ${calls.length} ${calls.length === 1 ? "call" : "calls"}`
            : ""}
        </span>
      </div>

      <div className="mt-1.5 flex flex-wrap gap-1">
        {events.map((link) => {
          const to = eventPath(link.id);
          const body = (
            <>
              <span
                aria-hidden
                className="size-1.5 shrink-0 rounded-[1px]"
                style={{ background: statusVar(link.status) }}
              />
              {link.label}
            </>
          );
          const title = `${link.id} — ${link.from} → ${link.to} (${link.status})`;
          return to ? (
            <Link
              key={`${link.id}:${link.to}`}
              to={to}
              className="chip border-line-strong"
              style={{ color: "var(--kind-event)" }}
              title={title}
            >
              {body}
            </Link>
          ) : (
            <span
              key={`${link.id}:${link.to}`}
              className="chip border-line-strong text-muted"
              title={title}
            >
              {body}
            </span>
          );
        })}
        {calls.map((link) => (
          <Ident
            key={`${link.id}:${link.to}`}
            value={link.id}
            className="chip border-line-strong text-muted"
            title={`${link.id} — ${link.to} calls ${link.from} (${link.status})`}
          >
            <span
              aria-hidden
              className="size-1.5 shrink-0 rounded-[1px]"
              style={{ background: statusVar(link.status) }}
            />
            {link.id}
          </Ident>
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
          measurement it was read from, and it is what makes the word checkable. */}
      <ul className="mt-3 flex flex-col gap-1">
        {relation.patterns.map((pattern) => (
          <li
            key={`why:${pattern.name}:${pattern.downstream ?? ""}`}
            className="mono flex gap-2 text-muted"
          >
            <span
              aria-hidden
              className="mt-1.5 size-1 shrink-0 rounded-[1px]"
              style={{
                background:
                  pattern.basis === "counted"
                    ? "var(--accent)"
                    : "var(--border-strong)",
              }}
            />
            <span className="min-w-0">{pattern.why}</span>
          </li>
        ))}
      </ul>

      {relation.dependencies.map((dependency) => (
        <Dependency
          key={`${dependency.upstream}->${dependency.downstream}`}
          dependency={dependency}
        />
      ))}

      {relation.shared.length > 0 ? (
        <Kernel shared={relation.shared} a={relation.a} b={relation.b} />
      ) : null}
    </section>
  );
}

export function ContextMap() {
  const relations = useMemo(() => contextMap(catalog), []);
  const wired = relations.filter(
    (r) => r.dependencies.length > 0 || r.shared.length > 0,
  ).length;

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
                {relations.map((relation, i) => (
                  <Relation key={relation.id} relation={relation} at={i} />
                ))}
              </div>
            )}
          </section>
        </div>

        <Toc items={TOC} label="Sections of the context map" />
      </div>
    </div>
  );
}
