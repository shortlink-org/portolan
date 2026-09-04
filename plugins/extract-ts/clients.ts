// A call to another service, read off the generated client the adapter holds.
//
// An HTTP peer: the adapter's file imports `createClient` from openapi-fetch
// and the `paths` type from its gen/, and a call `client.GET("/v1/x")` names
// the verb and the route in the code; the document vendored beside gen/ says
// which operation answers there. A gRPC peer: the adapter imports a service
// descriptor from a `*_pb` module and creates a Connect client from it; the
// descriptor's name is the service in the vendored .proto, whose package is
// the proto package, and a call `client.getQuote()` is the rpc in the proto's
// own case. Either way the id is the one the callee's extractor would give.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { callID, findOperation, readSpec, type Spec } from "./openapi.ts";
import type { Source } from "./source.ts";
import { isCall, isMember, isTemplate, memberName, stringOf, templateShape, walk, type CallExpression, type Node } from "./ast.ts";
import type { Diagnostics } from "./domain.ts";

/** One call the adapter makes, in the catalog's terms. */
export interface RpcHop {
  /** "auth.v1.Sessions/validateSession" or "shop.v1.Pricing/GetQuote" */
  id: string;
  /** What the manifest's peers map is keyed by: the api id or the proto package. */
  pkg: string;
  /** The document or the proto the call was named from. */
  source: string;
}

const HTTP_VERBS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

export interface ProtoService {
  pkg: string;
  name: string;
  rpcs: string[];
  source: string;
}

/** What one adapter file can reach: its HTTP document and its proto services. */
class Peer {
  readonly spec: Spec | undefined;
  readonly protos: ProtoService[];
  constructor(spec: Spec | undefined, protos: ProtoService[]) {
    this.spec = spec;
    this.protos = protos;
  }
}

const peers = new Map<string, Peer>();

function peerOf(src: Source, rel: (abs: string) => string, b: Diagnostics): Peer {
  const hit = peers.get(src.path);
  if (hit) return hit;

  let spec: Spec | undefined;
  const protos: ProtoService[] = [];
  for (const imp of src.imports) {
    if (!imp.file) continue;
    // gen/types.ts of openapi-typescript → gen/openapi.yaml beside it
    if (/[\\/]gen[\\/]/.test(imp.file) && imp.file.endsWith(".ts") && !/_pb\.ts$/.test(imp.file)) {
      const found = specBeside(dirname(imp.file));
      if (found) spec = readSpec(found);
    }
    // gen/**/<x>_pb.ts of Connect-ES → proto/**/*.proto beside gen/
    if (/_pb\.ts$/.test(imp.file)) {
      const gen = genDirAbove(imp.file);
      if (gen) protos.push(...readProtos(join(dirname(gen), "proto"), rel));
    }
  }
  if (!spec && src.imports.some((i) => i.specifier === "openapi-fetch")) {
    b.warn(rel(src.path), "creates an openapi-fetch client but imports no gen/types beside an openapi document, so its calls cannot be named");
  }
  if (protos.length === 0 && src.imports.some((i) => i.specifier.startsWith("@connectrpc/"))) {
    b.warn(rel(src.path), "creates a Connect client but imports no *_pb descriptor with a proto beside it, so its calls cannot be named");
  }
  const peer = new Peer(spec, protos);
  peers.set(src.path, peer);
  return peer;
}

/** The gen/ a generated file sits under, however deep its package path put it. */
function genDirAbove(file: string): string | undefined {
  let dir = dirname(file);
  for (let i = 0; i < 8 && dir !== dirname(dir); i++) {
    if (basename(dir) === "gen") return dir;
    dir = dirname(dir);
  }
  return undefined;
}

function specBeside(dir: string): string | undefined {
  for (const name of ["openapi.yaml", "openapi.yml", "swagger.yaml", "swagger.yml"]) {
    const path = join(dir, name);
    if (existsSync(path)) return path;
  }
  return undefined;
}

/** A minimal reading of .proto files: package, services, rpcs. */
export function readProtos(dir: string, rel: (abs: string) => string): ProtoService[] {
  if (!existsSync(dir)) return [];
  const out: ProtoService[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith(".proto")) out.push(...protoServices(readFileSync(p, "utf8"), rel(p)));
    }
  };
  walk(dir);
  return out;
}

function protoServices(text: string, source: string): ProtoService[] {
  const stripped = text.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const pkg = /^\s*package\s+([\w.]+)\s*;/m.exec(stripped)?.[1] ?? "";
  const out: ProtoService[] = [];
  const service = /\bservice\s+(\w+)\s*\{([^}]*)\}/g;
  for (let m = service.exec(stripped); m; m = service.exec(stripped)) {
    const rpcs = [...m[2]!.matchAll(/\brpc\s+(\w+)\s*\(/g)].map((r) => r[1]!);
    out.push({ pkg, name: m[1]!, rpcs, source });
  }
  return out;
}

/**
 * The calls one method of an adapter makes to its peer, in order. Read off
 * the method's body: `x.GET("/route")` for HTTP, `x.getQuote(...)` for gRPC.
 */
export function adapterCalls(src: Source, cls: string, method: string, rel: (abs: string) => string, b: Diagnostics): RpcHop[] {
  const c = src.classes.find((k) => k.name === cls);
  const m = c?.methods.get(method);
  if (!m?.body) return [];
  const peer = peerOf(src, rel, b);
  const out: RpcHop[] = [];
  const seen = new Set<string>();
  walk(m.body, (node) => {
    if (!isCall(node) || !isMember(node.callee)) return;
    const name = memberName(node.callee);
    const hop = name === undefined ? undefined : hopOf(peer, name, node, rel, b);
    if (hop && !seen.has(hop.id)) {
      seen.add(hop.id);
      out.push(hop);
    }
  });
  return out;
}

/** Calls from any body that reaches a generated client directly, by the same reading. */
export function callsIn(src: Source, node: Node, rel: (abs: string) => string, b: Diagnostics): RpcHop[] {
  const peer = peerOf(src, rel, b);
  if (!peer.spec && peer.protos.length === 0) return [];
  const out: RpcHop[] = [];
  walk(node, (n) => {
    if (!isCall(n) || !isMember(n.callee)) return;
    const name = memberName(n.callee);
    const hop = name === undefined ? undefined : hopOf(peer, name, n, rel, b);
    if (hop) out.push(hop);
  });
  return out;
}

function hopOf(peer: Peer, name: string, call: CallExpression, rel: (abs: string) => string, b: Diagnostics): RpcHop | undefined {
  if (HTTP_VERBS.has(name)) {
    if (!peer.spec) return undefined;
    const first = call.arguments[0];
    if (!first) return undefined;
    const route = stringOf(first) ?? (isTemplate(first) ? templateShape(first) : undefined);
    if (!route) return undefined;
    const op = findOperation(peer.spec, name, route);
    if (!op) {
      b.warn(rel(peer.spec.source), `calls ${name} ${route}, which the document does not declare; the call is left out`);
      return undefined;
    }
    return { id: callID(peer.spec, op), pkg: peer.spec.api, source: rel(peer.spec.source) };
  }
  for (const svc of peer.protos) {
    const rpc = svc.rpcs.find((r) => r.toLowerCase() === name.toLowerCase());
    if (rpc) return { id: `${svc.pkg}.${svc.name}/${rpc}`, pkg: svc.pkg, source: svc.source };
  }
  return undefined;
}

export function isOpenapiFetchClientType(type: string): boolean {
  return /^Client<\s*paths\s*>$/.test(type.trim());
}
