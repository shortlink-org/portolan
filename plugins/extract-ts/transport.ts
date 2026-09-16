// Endpoints, read off src/infrastructure/transport.
//
// Over HTTP the document's operationIds name the handlers; over gRPC the
// contract vendored beside the handler does, and an rpc is named the same on
// both sides - `planRoute` answers `PlanRoute`. Either way a handler's body
// names the use cases it runs, in order, and that is what opens a flow. A job
// is the same edge with a clock on the other side: nobody calls in, and the
// class says its own name and how often it fires.

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { readSpec, type Spec } from "./openapi.ts";
import { readProtos } from "./clients.ts";
import { readSource, type ClassInfo, type Source, at } from "./source.ts";
import { isBinary, isCall, isMember, isNumber, isPropertyDef, isSourceFile, keyName, memberName, thisMember, walk, type Node } from "./ast.ts";
import { zodFields } from "./rules.ts";
import type { Field } from "../../src/catalog.ts";
import { useCaseKeyOf } from "./operations.ts";
import type { WarningSink } from "./domain.ts";

export interface Endpoint {
  /** The operationId. */
  id: string;
  /** file:line of the handler. */
  line: string;
  source: string;
  /** Source-backed transport entry that starts the flow. */
  trigger: {
    kind: "http" | "callback";
    label: string;
    confidence: "high";
  };
  /** Use case keys, in the order the handler runs them. */
  useCases: string[];
  /** What the handler parses out of the request before it runs anything, when it says so in a schema. */
  request?: Field[];
}

/** A job under transport/job: an edge a clock opens rather than a caller. */
export interface Job {
  /** The class's `name`, which the flow is called by. */
  id: string;
  /** file:line of `run`. */
  line: string;
  source: string;
  /** The first paragraph of the class's doc comment. */
  doc: string;
  trigger: {
    kind: "scheduled";
    label: string;
    confidence: "high";
  };
  /** Use case keys, in the order `run` runs them. */
  useCases: string[];
}

export interface Transport {
  spec: Spec | undefined;
  endpoints: Endpoint[];
}

/**
 * The gRPC half: one directory per aggregate, the contract it answers vendored
 * under it, and a handler whose methods are that contract's rpcs. The endpoint
 * is called what the proto calls it, which is the name `extract-proto` puts in
 * `provides`, so an operation and the interface that exposes it meet.
 */
export function readGrpcTransport(grpcDir: string, rel: (abs: string) => string, b: WarningSink): Endpoint[] {
  if (!existsSync(grpcDir)) return [];
  const endpoints: Endpoint[] = [];

  for (const pkg of readdirSync(grpcDir).sort()) {
    const dir = join(grpcDir, pkg);
    if (!statSync(dir).isDirectory()) continue;

    const contracts = readProtos(join(dir, "proto"), rel);
    if (contracts.length === 0) {
      b.warn(rel(dir), "a grpc handler with no contract vendored beside it: nothing says which rpc its methods answer");
      continue;
    }
    const rpcs = new Map<string, string>();
    for (const contract of contracts) {
      for (const rpc of contract.rpcs) rpcs.set(rpc.toLowerCase(), rpc);
    }
    const answered = new Set<string>();

    for (const name of readdirSync(dir).sort()) {
      if (!isSourceFile(name)) continue;
      const src = readSource(join(dir, name));
      if (!src) continue;
      for (const cls of src.classes) {
        const ports = useCasePorts(src, cls);
        for (const [method, m] of cls.methods) {
          const rpc = rpcs.get(method.toLowerCase());
          if (!rpc || answered.has(rpc)) continue;
          answered.add(rpc);
          endpoints.push({
            id: rpc,
            line: at(src, m.node, rel),
            source: rel(src.path),
            trigger: { kind: "callback", label: `gRPC · ${rpc}`, confidence: "high" },
            useCases: useCasesRun(m.node, ports),
          });
        }
      }
    }

    for (const [, rpc] of rpcs) {
      if (!answered.has(rpc)) {
        b.warn(rel(dir), rpc + " is declared by the contract and answered by no method here");
      }
    }
  }

  return endpoints.sort((a, c) => a.id.localeCompare(c.id));
}

export function readTransport(httpDir: string, rel: (abs: string) => string, b: WarningSink): Transport {
  const specPath = join(httpDir, "gen", "openapi.yaml");
  if (!existsSync(specPath)) return { spec: undefined, endpoints: [] };
  const spec = readSpec(specPath);
  const wanted = new Map(spec.operations.map((op) => [op.id, op]));
  const endpoints: Endpoint[] = [];
  const found = new Set<string>();

  for (const pkg of readdirSync(httpDir).sort()) {
    const dir = join(httpDir, pkg);
    if (pkg === "gen" || !statSync(dir).isDirectory()) continue;
    for (const name of readdirSync(dir).sort()) {
      if (!isSourceFile(name)) continue;
      const src = readSource(join(dir, name));
      if (!src) continue;
      for (const cls of src.classes) {
        const ports = useCasePorts(src, cls);
        for (const [method, m] of cls.methods) {
          if (!wanted.has(method) || found.has(method)) continue;
          const operation = wanted.get(method)!;
          found.add(method);
          const request = requestShape(src, m.node);
          endpoints.push({
            id: method,
            line: at(src, m.node, rel),
            source: rel(src.path),
            trigger: {
              kind: "http",
              label: `${operation.verb} ${operation.path}`,
              confidence: "high",
            },
            useCases: useCasesRun(m.node, ports),
            ...(request ? { request } : {}),
          });
        }
      }
    }
  }
  for (const id of wanted.keys()) {
    if (!found.has(id)) b.warn(id, `${rel(specPath)} declares ${id} but no handler under ${rel(httpDir)} is named by it`);
  }
  endpoints.sort((a, c) => a.id.localeCompare(c.id));
  return { spec, endpoints };
}

/**
 * The jobs: every exported class in a file under `transport/job` with a
 * `name` string, an `everyMs` number and a `run` method. Anything else in the
 * directory - the scheduler that starts them, the interface they share - has
 * none of the three and is not read. A class with a name and a run but no
 * interval the syntax can say is reported rather than guessed at.
 */
export function readJobs(jobDir: string, rel: (abs: string) => string, b: WarningSink): Job[] {
  if (!existsSync(jobDir)) return [];
  const jobs: Job[] = [];
  for (const name of readdirSync(jobDir).sort()) {
    if (!isSourceFile(name) || /\.test\.[cm]?[jt]sx?$/.test(name)) continue;
    const src = readSource(join(jobDir, name));
    if (!src) continue;
    for (const cls of src.classes) {
      const run = cls.methods.get("run");
      if (!cls.exported || !cls.nameLiteral || !run) continue;
      const every = everyMsOf(cls);
      if (every === undefined) {
        b.warn(cls.nameLiteral, `${rel(src.path)}: ${cls.name} is named and runs, but has no \`everyMs\` a number literal says; the job opens no flow`);
        continue;
      }
      const useCases = useCasesRun(run.node, useCasePorts(src, cls));
      if (useCases.length === 0) b.warn(cls.nameLiteral, `${rel(src.path)}: ${cls.name}.run runs no use case; the job's flow is the clock and nothing after it`);
      jobs.push({
        id: cls.nameLiteral,
        line: at(src, run.node, rel),
        source: rel(src.path),
        doc: cls.doc.split(/\n\s*\n/)[0]?.replace(/\s+/g, " ") ?? "",
        trigger: { kind: "scheduled", label: every, confidence: "high" },
        useCases,
      });
    }
  }
  return jobs.sort((a, c) => a.id.localeCompare(c.id));
}

/** `readonly everyMs = 60_000`, or a product of literals, `24 * 60 * 60 * 1000`, as "every minute". */
function everyMsOf(cls: ClassInfo): string | undefined {
  for (const member of cls.node.body.body) {
    if (!isPropertyDef(member) || member.static || keyName(member.key) !== "everyMs" || !member.value) continue;
    const ms = product(member.value);
    return ms === undefined || ms <= 0 ? undefined : every(ms);
  }
  return undefined;
}

function product(n: Node): number | undefined {
  if (isNumber(n)) return n.value;
  if (isBinary(n) && n.operator === "*") {
    const l = product(n.left);
    const r = product(n.right);
    return l === undefined || r === undefined ? undefined : l * r;
  }
  return undefined;
}

/** 60000 → "every minute", 7200000 → "every 2 hours", 1500 → "every 1500 ms". */
export function every(ms: number): string {
  const units: [number, string][] = [
    [86_400_000, "day"],
    [3_600_000, "hour"],
    [60_000, "minute"],
    [1_000, "second"],
  ];
  for (const [size, unit] of units) {
    if (ms % size !== 0) continue;
    const n = ms / size;
    return n === 1 ? `every ${unit}` : `every ${n} ${unit}s`;
  }
  return `every ${ms} ms`;
}

/** Constructor parameters whose type is a UseCase import: field name → use case key. */
export function useCasePorts(src: Source, cls: ClassInfo): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of cls.params) {
    const local = p.type.replace(/^typeof\s+/, "").trim();
    const imp = src.imports.find((i) => i.local === local);
    if (!imp?.file || imp.imported !== "UseCase") continue;
    const key = useCaseKeyOf(imp.file);
    if (key) out.set(p.name, key);
  }
  return out;
}

/**
 * What the caller hands in, as the handler itself checks it: every schema it
 * parses the request with, in the order it parses them, as one shape. A
 * handler that parses the route's parameters and then the body has stated one
 * request in two halves, and the first word about a name is the one kept.
 *
 * Undefined is a handler that parses nothing a schema says - a body read
 * straight off the request, a service that validates somewhere else - which
 * is not the same claim as a request with no fields.
 */
function requestShape(src: Source, node: Node): Field[] | undefined {
  const out: Field[] = [];
  let parsed = false;
  walk(node, (n) => {
    if (!isCall(n) || !isMember(n.callee)) return;
    const called = memberName(n.callee);
    if (called !== "parse" && called !== "safeParse") return;
    const fields = zodFields(src, n.callee.object);
    if (!fields) return;
    parsed = true;
    for (const field of fields) {
      if (!out.some((f) => f.name === field.name)) out.push(field);
    }
  });
  return parsed ? out : undefined;
}

/** `this.<port>.handle(...)` calls, in source order, as use case keys. */
function useCasesRun(node: Node, ports: Map<string, string>): string[] {
  const out: string[] = [];
  walk(node, (n) => {
    if (!isCall(n) || !isMember(n.callee) || memberName(n.callee) !== "handle") return;
    const port = thisMember(n.callee.object);
    const key = port === undefined ? undefined : ports.get(port);
    if (key) out.push(key);
  });
  return out;
}
