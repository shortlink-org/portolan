// The "then what" tree, drawn in the rail's own vocabulary: an indented row per
// node, a status square at the end of every row, and the corner arrow the rail
// uses for "continues in". Every row links to the thing it names, and a receipt
// or a published event links to the step it was read from.

import { Link } from "react-router";
import { CornerDownRight } from "lucide-react";

import { statusVar } from "../components/primitives";
import { ctxStyle } from "../lib/context-color";
import { plural } from "../lib/format";
import { eventPath, paths, servicePath } from "../routes";
import { CHAIN_BUDGET } from "./chain";
import type { ChainCut, ChainNode, EventChain } from "./chain";

const indent = (depth: number) => 8 + depth * 12;

export function ChainList({ chain }: { chain: EventChain }) {
  return (
    <div className="flex flex-col" data-nav-list>
      {chain.nodes.map((node, i) => (
        <Row key={`${i}`} node={node} path={`${i}`} />
      ))}
      {chain.truncated ? (
        <div
          className="mono py-0.5 text-muted"
          style={{ paddingLeft: indent(0) }}
          title={`the walk stops at ${CHAIN_BUDGET} rows`}
        >
          … and more than fits here
        </div>
      ) : null}
    </div>
  );
}

function Row({ node, path }: { node: ChainNode; path: string }) {
  return (
    <>
      <div
        className="flex items-start gap-2 py-0.5 pr-2"
        style={{ paddingLeft: indent(node.depth) }}
      >
        <Label node={node} />
        <span
          aria-hidden
          className="mt-1.5 ml-auto size-1.5 shrink-0 rounded-[1px]"
          style={{ background: statusVar(node.status) }}
          title={
            node.worst === node.status
              ? node.status
              : `${node.status}; ${node.worst} further down`
          }
        />
      </div>
      {node.kind === "consumer" && node.known && node.children.length === 0 ? (
        <Aside depth={node.depth + 1}>no flow shows this service hearing it</Aside>
      ) : null}
      {node.children.map((child, i) => (
        <Row key={`${path}.${i}`} node={child} path={`${path}.${i}`} />
      ))}
      {node.cut ? <Cut cut={node.cut} depth={node.depth + 1} /> : null}
    </>
  );
}

function Label({ node }: { node: ChainNode }) {
  switch (node.kind) {
    case "consumer": {
      const to = servicePath(node.service);
      return (
        <span className="mono flex min-w-0 flex-wrap items-center gap-1.5">
          {to ? (
            <Link to={to} data-nav-item className="rounded-control text-accent">
              {node.service}
            </Link>
          ) : (
            <span className="text-unresolved" title="no service in the catalog answers to this name">
              {node.service}
            </span>
          )}
          {node.context ? <ContextChip id={node.context} /> : null}
          {node.via ? (
            <span
              className="text-muted"
              title={`read from flow ${node.via.flow}, step ${node.via.step}; no source declares it`}
            >
              via flow
            </span>
          ) : null}
        </span>
      );
    }
    case "receipt":
      return (
        <Link
          to={paths.flowStep(node.flow, node.stepId)}
          data-nav-item
          className="mono flex min-w-0 items-center gap-1 rounded-control text-accent hover:underline"
          title={`the step where it hears the event, in ${node.name}`}
        >
          <CornerDownRight size={9} aria-hidden className="shrink-0" />
          <span className="truncate">
            in {node.name} · step {node.number}
          </span>
        </Link>
      );
    case "event": {
      const to = eventPath(node.id);
      return (
        <span className="mono flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="text-muted">publishes</span>
          {to ? (
            <Link to={to} data-nav-item className="rounded-control text-accent">
              {node.name}
            </Link>
          ) : (
            <span>{node.name}</span>
          )}
          {node.context ? <ContextChip id={node.context} /> : null}
          <Link
            to={paths.flowStep(node.flow, node.stepId)}
            className="text-muted hover:text-ink hover:underline"
            title="the step it is published at"
          >
            step {node.number}
          </Link>
        </span>
      );
    }
  }
}

function ContextChip({ id }: { id: string }) {
  return (
    <span className="chip ctx" style={ctxStyle(id)}>
      <span aria-hidden className="dot" />
      {id}
    </span>
  );
}

function Aside({ depth, children }: { depth: number; children: string }) {
  return (
    <div className="mono py-0.5 text-muted" style={{ paddingLeft: indent(depth) }}>
      {children}
    </div>
  );
}

function Cut({ cut, depth }: { cut: ChainCut; depth: number }) {
  const n = cut.hidden;
  const text =
    cut.reason === "cycle"
      ? "already on this path — the chain comes back around"
      : cut.reason === "seen"
        ? "followed above"
        : cut.reason === "depth"
        ? `${n} ${plural(n, "consumer")} further down, past the depth this page follows`
        : `and ${n} more`;
  return <Aside depth={depth}>{text}</Aside>;
}
