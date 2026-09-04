// One service in, one fragment out. A fragment, not a catalog: it carries one
// context and one service, names peers it does not own, and is merged with
// everything else before anything validates it.

import { existsSync, readFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import type { Catalog, Service } from "../../src/catalog.ts";
import { readAggregates, type Diagnostics } from "./domain.ts";
import { operationOf, readUseCases } from "./operations.ts";
import { readBindings } from "./wiring.ts";
import { readGrpcTransport, readTransport } from "./transport.ts";
import { FlowReader } from "./flows.ts";
import { serviceID, title } from "./ids.ts";

export interface Options {
  context?: string;
  contextName?: string;
  contextSummary?: string;
  classification?: "core" | "supporting" | "generic";
  service?: string;
  serviceName?: string;
  repo?: string;
  store?: string;
  peers?: Record<string, string>;
  events?: Record<string, string>;
  source?: string;
  out?: string;
}

export interface Input {
  root: string;
  commit: string;
  generatedAt: string;
}

export interface Diagnostic {
  severity: "warning" | "error";
  message: string;
  ref?: string;
}

export interface Response {
  files: { name: string; contents: string }[];
  diagnostics: Diagnostic[];
}

class Builder implements Diagnostics {
  files: { name: string; contents: string }[] = [];
  diagnostics: Diagnostic[] = [];
  warn(ref: string, message: string): void {
    this.diagnostics.push({ severity: "warning", message, ref });
  }
}

export function extract(input: Input, opts: Options, cwd = process.cwd()): Response {
  const b = new Builder();
  const root = resolve(cwd, input.root);
  const rel = (abs: string): string => relative(cwd, abs).split("\\").join("/");
  const src = join(root, opts.source ?? "src");

  const context = opts.context || basename(root);
  const service = opts.service || basename(root);
  const svcID = serviceID(context, service);
  const readme = existsSync(join(root, "README.md")) ? readFileSync(join(root, "README.md"), "utf8").trim() : "";

  const aggregates = readAggregates(join(src, "domain"), svcID, rel, b);
  const useCases = readUseCases(join(src, "application"), rel, b);
  const bindings = readBindings(join(src, "di"));
  const transport = readTransport(join(src, "infrastructure", "transport", "http"), rel, b);
  // A service may answer over both, and a service that answers over neither is
  // read the same way with nothing to show for it.
  transport.endpoints.push(...readGrpcTransport(join(src, "infrastructure", "transport", "grpc"), rel, b));

  // Operations belong to the aggregate their use case sits under.
  const exposedBy = new Map<string, string[]>();
  for (const endpoint of transport.endpoints) {
    for (const key of endpoint.useCases) exposedBy.set(key, [...(exposedBy.get(key) ?? []), endpoint.id]);
  }
  for (const uc of useCases) {
    const agg = aggregates.find((a) => a.aggregate.slug === uc.aggregate);
    if (!agg) {
      b.warn(svcID, `${rel(uc.dir)} sits under application/${uc.aggregate}, but there is no matching aggregate under domain`);
      continue;
    }
    const op = operationOf(uc);
    const routes = exposedBy.get(uc.key);
    if (routes) op.exposedBy = [...routes].sort();
    agg.aggregate.operations.push(op);
  }
  for (const agg of aggregates) agg.aggregate.operations.sort((a, c) => a.id.localeCompare(c.id));

  const reader = new FlowReader(
    { context, svcID, service, store: opts.store ?? "", peers: opts.peers ?? {}, events: opts.events ?? {} },
    new Map(useCases.map((u) => [u.key, u])),
    bindings,
    aggregates,
    rel,
    b,
  );
  const flows = [];
  for (const endpoint of transport.endpoints) {
    const flow = reader.endpointFlow(endpoint);
    if (flow) flows.push(flow);
  }
  flows.push(...reader.policyFlows(join(src, "application", "policy")));
  for (const agg of aggregates) {
    for (const [, id] of agg.events) {
      if (!reader.referenced.has(id)) b.warn(id, "no flow reaches this event: nothing this extractor could follow publishes it");
    }
  }

  const svc: Service = {
    id: svcID,
    slug: service,
    name: opts.serviceName || readmeTitle(readme) || title(service),
    repo: opts.repo || packageRepo(root),
    path: rel(root),
    readme,
    provides: [],
    consumes: reader.consumes(),
    aggregates: aggregates.map((a) => a.aggregate),
  };
  if (aggregates.length === 0) b.warn(svcID, "no aggregates found under domain; the fragment describes a service with no model");

  const fragment: Catalog = {
    generatedAt: input.generatedAt,
    commit: input.commit,
    contexts: [
      {
        id: context,
        slug: context,
        name: opts.contextName || title(context),
        summary: opts.contextSummary ?? "",
        ...(opts.classification ? { classification: opts.classification } : {}),
        services: [svc],
      },
    ],
    defs: {},
    flows,
    adrs: [],
  };
  b.files.push({ name: opts.out || "domain.json", contents: `${JSON.stringify(fragment, null, 2)}\n` });
  return { files: b.files, diagnostics: b.diagnostics };
}

function readmeTitle(md: string): string {
  for (const line of md.split("\n")) {
    const t = line.trim();
    if (t.startsWith("# ")) return t.slice(2).trim();
  }
  return "";
}

/** package.json's repository, spelled the way go.mod spells a module: host/owner/name. */
function packageRepo(root: string): string {
  const path = join(root, "package.json");
  if (!existsSync(path)) return "";
  try {
    const pkg = JSON.parse(readFileSync(path, "utf8")) as { repository?: string | { url?: string } };
    const url = typeof pkg.repository === "string" ? pkg.repository : (pkg.repository?.url ?? "");
    return url
      .replace(/^git\+/, "")
      .replace(/^(https?|ssh):\/\//, "")
      .replace(/^git@/, "")
      .replace(":", "/")
      .replace(/\.git$/, "")
      .replace(/\/$/, "");
  } catch {
    return "";
  }
}
