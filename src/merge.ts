// Merging sources into one catalog.
//
// The estate is not written down in one place. A service publishes facts about
// itself next to its own code, an authored file carries the prose nobody can
// generate, and what a reader sees is the union. There is no master file, and
// deliberately so: a single catalog.json would have to be written by whoever
// owns the repository it lives in, which is exactly the bottleneck this avoids.
//
// Two things follow from that, and both are the point rather than the cost:
//
//  - Merging happens BEFORE validation. Referential integrity is a property of
//    the union, not of any one source, so a source that names a peer it does
//    not own is normal rather than broken.
//  - A conflict is a value, not an exception. Two sources disagreeing about a
//    context's name is a fact about the estate that belongs on the Problems
//    page, next to the other things that are true and unfortunate.

import type {
  Aggregate,
  Alt,
  AltBranch,
  BoundedContext,
  Catalog,
  Channel,
  Flow,
  FlowNode,
  Loop,
  Parallel,
  Service,
  Status,
  Step,
  TypeDef,
} from "./catalog";

/**
 * A catalog as a FILE may carry it, which is not quite a catalog as a reader
 * gets one: the two stamps are optional here and required downstream.
 *
 * The host stamps what it generates, from the last commit that touched the
 * input the fragment was read from. A file nobody generates - the estate's
 * hand-written facts - is stamped by nobody, and a provenance typed in by hand
 * is a claim no process keeps true: it stays where it was typed while the
 * estate moves on, and being the oldest stamp in the corpus it then dates the
 * whole merged catalog. So a source is allowed to carry no stamp at all, and
 * saying nothing is treated as what it is - an absence of evidence, which
 * drops out of the merge rather than voting in it.
 */
export type SourceCatalog = Omit<Catalog, "generatedAt" | "commit"> &
  Partial<Pick<Catalog, "generatedAt" | "commit">>;

/** One file, parsed. */
export interface CatalogSource {
  /** Where it was read from, as a reader would type it. */
  path: string;
  catalog: SourceCatalog;
}

/**
 * When a source was generated and from what. This is per-source and never
 * merged into one number: a catalog whose domain facts are a day old and whose
 * schema facts are a month old is not "three weeks stale", it is two claims of
 * different ages, and averaging them hides the one that matters.
 *
 * Both fields are empty for a source that carries no stamp, so the shape of a
 * stamp does not depend on whether there was one to read.
 */
export interface SourceStamp {
  path: string;
  generatedAt: string;
  commit: string;
}

export interface MergeConflict {
  /** The source that lost - the one whose value was not taken. */
  path: string;
  /** What the conflict is about, as a catalog id. */
  where: string;
  message: string;
}

export interface MergeResult {
  catalog: Catalog;
  sources: SourceStamp[];
  conflicts: MergeConflict[];
}

/**
 * Merges sources in path order, so the result never depends on the order a
 * glob happened to return.
 *
 * First writer wins for anything scalar, and the loser is recorded rather than
 * dropped silently. Lists are unioned by id.
 */
export function mergeCatalogs(sources: CatalogSource[]): MergeResult {
  const ordered = [...sources].sort((a, b) => a.path.localeCompare(b.path));
  const conflicts: MergeConflict[] = [];

  const contexts = new Map<string, BoundedContext>();
  const contextOrigin = new Map<string, string>();
  const services = new Map<string, Service>();
  const serviceOrigin = new Map<string, string>();
  const defs: Record<string, TypeDef> = {};
  const defOrigin = new Map<string, string>();
  const flows: Catalog["flows"] = [];
  const adrs: Catalog["adrs"] = [];
  const stores: NonNullable<Catalog["stores"]> = [];
  const modules: NonNullable<Catalog["modules"]> = [];
  const terms: NonNullable<Catalog["terms"]> = [];
  const repos: NonNullable<Catalog["repos"]> = [];
  const repoOrigin = new Map<string, string>();
  const seen = new Map<string, string>(); // flow/adr/store/module/term id -> source path

  const stamps: SourceStamp[] = ordered.map((source) => ({
    path: source.path,
    generatedAt: source.catalog.generatedAt ?? "",
    commit: source.catalog.commit ?? "",
  }));

  for (const { path, catalog } of ordered) {
    for (const context of catalog.contexts) {
      const existing = contexts.get(context.id);
      if (!existing) {
        // The services list is filled from the merge below, not copied: a
        // service can be described by several sources at once, and the context
        // has to end up holding the merged one rather than the first arrival.
        contexts.set(context.id, { ...context, services: [] });
        contextOrigin.set(context.id, path);
      } else {
        // A second source may add services to a context somebody else named.
        // What it may not do is quietly rename it.
        const owner = contextOrigin.get(context.id) ?? "";
        // First NON-EMPTY wins, not first. A fragment describing one aspect of
        // a service leaves the fields it knows nothing about empty, and it can
        // easily sort before the one that fills them in - so an empty value
        // yields rather than winning and calling the real one a conflict.
        for (const field of ["name", "summary"] as const) {
          const theirs = context[field];
          if (!theirs) continue;
          if (!existing[field]) {
            existing[field] = theirs;

            continue;
          }
          if (theirs !== existing[field]) {
            conflicts.push({
              path,
              where: context.id,
              message: `context "${context.id}" has ${field} "${theirs}" here and "${existing[field]}" in ${owner}; the first one is used`,
            });
          }
        }

        // Classification is its own line only because it is not a plain string:
        // the same rule, spelled where the type can see it.
        if (context.classification) {
          if (!existing.classification) {
            existing.classification = context.classification;
          } else if (existing.classification !== context.classification) {
            conflicts.push({
              path,
              where: context.id,
              message: `context "${context.id}" is classified ${context.classification} here and ${existing.classification} in ${owner}; the first one is used`,
            });
          }
        }
      }

      for (const service of context.services) {
        mergeService(services, serviceOrigin, service, path, conflicts);
      }
    }

    for (const [key, def] of Object.entries(catalog.defs)) {
      const existing = defs[key];
      if (existing === undefined) {
        defs[key] = def;
        defOrigin.set(key, path);

        continue;
      }
      // Shared types live in one namespace on purpose: `ref` is a bare key, so
      // two sources meaning different things by "Money" is a real problem and
      // not one a prefix would solve - it would only make it invisible.
      if (JSON.stringify(existing) !== JSON.stringify(def)) {
        conflicts.push({
          path,
          where: `defs.${key}`,
          message: `shared type "${key}" is defined differently here than in ${defOrigin.get(key)}; the first one is used`,
        });
      }
    }

    for (const flow of catalog.flows) {
      const owner = seen.get(flow.id);
      if (owner === undefined) {
        seen.set(flow.id, path);
        flows.push(flow);

        continue;
      }
      // A second declaration of the same flow is allowed to say one thing:
      // that some of its steps have been seen running. That is what a source
      // built from traces knows and a source built from code cannot, and the
      // two meet here, on the step. Anything else about the flow - a lane, a
      // hop, a branch - has to agree, or the second one is the conflict it
      // always was.
      const at = flows.findIndex((f) => f.id === flow.id);
      const raised = overlayFlow(flows[at]!, flow);
      if (raised) {
        flows[at] = raised;

        continue;
      }
      conflicts.push({
        path,
        where: flow.id,
        message: `flow "${flow.id}" is already declared in ${owner}; the one here is ignored`,
      });
    }
    for (const adr of catalog.adrs) {
      if (claim(seen, adr.id, path, conflicts, "ADR")) adrs.push(adr);
    }
    for (const store of catalog.stores ?? []) {
      if (claim(seen, store.id, path, conflicts, "store")) stores.push(store);
    }
    // Claimed by id like everything else at this level, and that is exactly why
    // a module's id is its registry-global name rather than one derived from an
    // owner: the producer and each consumer describe the same module from
    // different repositories, and only a shared id makes them one entry here.
    for (const module of catalog.modules ?? []) {
      if (claim(seen, module.id, path, conflicts, "module"))
        modules.push(module);
    }
    // A term's id carries its context, so the same word in two contexts is two
    // entries and merges as two. What collides here is one word defined twice
    // inside ONE context - two services of it keeping glossaries that disagree
    // - which is the failure a glossary is written to prevent, reported where
    // the reader can see both sources rather than settled by file order.
    for (const term of catalog.terms ?? []) {
      if (claim(seen, term.id, path, conflicts, "term")) terms.push(term);
    }
    // Not claimed by id like the rest, because agreeing is the normal case
    // rather than a collision: one fetch step writes one fragment per
    // repository, and two extractors reading two services out of that one copy
    // are describing the same pin. Saying the same thing twice is silence.
    // Saying two different things is the conflict - the copy on disk is at one
    // commit, so a second answer means a fragment left over from a pin that
    // moved, and a link built from it would point at code the reader never saw.
    for (const pin of catalog.repos ?? []) {
      const owner = repoOrigin.get(pin.repo);
      if (owner === undefined) {
        repoOrigin.set(pin.repo, path);
        repos.push(pin);

        continue;
      }
      const held = repos.find((r) => r.repo === pin.repo)!;
      if (held.commit === pin.commit) continue;
      conflicts.push({
        path,
        where: pin.repo,
        message: `repository "${pin.repo}" is pinned to ${pin.commit} here and to ${held.commit} in ${owner}; the first one is used`,
      });
    }
  }

  // Services go back into their contexts once every source has been read, in
  // the order they were first declared.
  for (const service of services.values()) {
    const contextID = service.id.slice(0, service.id.indexOf("."));
    contexts.get(contextID)?.services.push(service);
  }

  const merged: Catalog = {
    // The oldest stamp, because a merged catalog is exactly as fresh as its
    // stalest part. Per-source stamps travel alongside for anything that wants
    // to be precise about which part that is - the Overview stamp opens onto
    // them, which is what makes "6 sources" a number a reader can go and read.
    //
    // Only stamped sources are counted. An unstamped one is not the stalest
    // part of anything; it is a part with no age, and a merge that let it vote
    // would report the age of the file nobody generates.
    generatedAt: oldest(stamps.map((s) => s.generatedAt)),
    commit: describeCommits(stamps),
    contexts: [...contexts.values()],
    defs,
    flows,
    adrs,
  };
  if (stores.length > 0) merged.stores = stores;
  if (modules.length > 0) merged.modules = modules;
  if (terms.length > 0) merged.terms = terms;
  if (repos.length > 0) merged.repos = repos;

  return { catalog: merged, sources: stamps, conflicts };
}

/**
 * Merges one service into the set.
 *
 * This is what lets a service be described by more than one source at a time,
 * which is the whole point of extracting each aspect separately: one generator
 * reads the domain and knows the aggregates, another reads the OpenAPI spec and
 * knows what the service answers, and neither has to know about the other.
 *
 * Lists are unioned by id; scalars keep the first value and record the loser.
 */
function mergeService(
  services: Map<string, Service>,
  origin: Map<string, string>,
  incoming: Service,
  path: string,
  conflicts: MergeConflict[],
): void {
  const existing = services.get(incoming.id);
  if (!existing) {
    services.set(incoming.id, {
      ...incoming,
      provides: [...incoming.provides],
      consumes: [...incoming.consumes],
      aggregates: incoming.aggregates.map(copyAggregate),
      ...(incoming.stores ? { stores: [...incoming.stores] } : {}),
      ...(incoming.modules ? { modules: [...incoming.modules] } : {}),
      ...(incoming.channels
        ? { channels: incoming.channels.map(copyChannel) }
        : {}),
    });
    origin.set(incoming.id, path);

    return;
  }

  const owner = origin.get(incoming.id) ?? "";
  for (const field of ["name", "repo", "path", "readme"] as const) {
    const theirs = incoming[field];
    if (!theirs) continue;
    if (!existing[field]) {
      existing[field] = theirs;

      continue;
    }
    if (theirs !== existing[field]) {
      conflicts.push({
        path,
        where: incoming.id,
        message: `service "${incoming.id}" has a different ${field} here than in ${owner}; the first one is used`,
      });
    }
  }

  appendNew(existing.provides, incoming.provides, (p) => p.id);
  appendNew(existing.consumes, incoming.consumes, (c) => c.id, raise);
  mergeAggregates(existing.aggregates, incoming.aggregates);

  if (incoming.stores?.length) {
    const stores = existing.stores ?? [];
    for (const id of incoming.stores) if (!stores.includes(id)) stores.push(id);
    existing.stores = stores;
  }

  if (incoming.modules?.length) {
    const modules = existing.modules ?? [];
    for (const id of incoming.modules)
      if (!modules.includes(id)) modules.push(id);
    existing.modules = modules;
  }

  if (incoming.channels?.length) {
    // Keyed by address, because that is the whole of a channel's identity. Two
    // documents describing one channel is not a conflict worth reporting - a
    // service may split its bus across several - so the first one keeps the
    // messages it declared and the second adds the ones it knows about.
    const channels = existing.channels ?? [];
    appendNew(
      channels,
      incoming.channels.map(copyChannel),
      (c) => c.address,
      (mine, theirs) => {
        appendNew(
          mine.messages,
          theirs.messages,
          (m) => `${m.direction} ${m.name}`,
        );

        // Mutated in place: the channel that was here keeps its prose and its
        // source, and gains the messages the other document named.
        return undefined;
      },
    );
    existing.channels = channels;
  }
}

function copyChannel(channel: Channel): Channel {
  return { ...channel, messages: [...channel.messages] };
}

/**
 * Unions aggregates by id, and inside a shared aggregate unions events by id,
 * and inside a shared event unions consumers by service.
 *
 * Union stops one level short of the scalars on purpose. Two sources both
 * describing `shop.oms.order` are the domain extractor and something that
 * knows one more thing about it - typically who listens to its events, which
 * is a fact the producer's repository cannot hold. The fields they both fill
 * in keep the first value like everything else here; what the second one adds
 * is kept rather than thrown away with the whole aggregate.
 */
function mergeAggregates(
  into: Aggregate[],
  from: Aggregate[],
): void {
  const byId = new Map(into.map((a) => [a.id, a]));
  for (const incoming of from) {
    const existing = byId.get(incoming.id);
    if (!existing) {
      const copy = copyAggregate(incoming);
      into.push(copy);
      byId.set(copy.id, copy);

      continue;
    }
    const events = new Map(existing.events.map((e) => [e.id, e]));
    for (const event of incoming.events) {
      const known = events.get(event.id);
      if (!known) {
        const copy = { ...event, consumers: [...event.consumers] };
        existing.events.push(copy);
        events.set(copy.id, copy);

        continue;
      }
      appendNew(known.consumers, event.consumers, (c) => c.service, raise);
    }
  }
}

/** A copy deep enough that unioning into it never writes into a source. */
function copyAggregate(aggregate: Aggregate): Aggregate {
  return {
    ...aggregate,
    events: aggregate.events.map((e) => ({ ...e, consumers: [...e.consumers] })),
  };
}

/**
 * Appends the entries whose id is not already present. An entry that IS
 * present is left alone, unless `meet` is given: then the two are handed to
 * it, because for a few kinds of entry a second source can add to the first
 * without contradicting it.
 */
function appendNew<T>(
  into: T[],
  from: T[],
  id: (item: T) => string,
  meet?: (existing: T, incoming: T) => T | undefined,
): void {
  const at = new Map(into.map((item, i) => [id(item), i]));
  for (const item of from) {
    const i = at.get(id(item));
    if (i !== undefined) {
      const replaced = meet?.(into[i]!, item);
      if (replaced !== undefined) into[i] = replaced;

      continue;
    }
    at.set(id(item), into.length);
    into.push(item);
  }
}

/**
 * Where two sources describe the same edge, `verified` wins. A code reader
 * says a call is declared; a trace says it happened; the second does not
 * contradict the first, it knows more. Nothing else about the edge moves:
 * the first note stays unless there was none.
 */
function raise<T extends { status: Status; note?: string }>(
  existing: T,
  incoming: T,
): T | undefined {
  if (incoming.status !== "verified" || existing.status === "verified") return undefined;
  const raised = { ...existing, status: "verified" as Status };
  if (!raised.note && incoming.note) raised.note = incoming.note;

  return raised;
}

/**
 * The same flow, declared twice, where the second declaration differs only in
 * what it can vouch for. Returns a copy of the first with every step the
 * second marks `verified` raised, or undefined when the two disagree about
 * anything but status - a different lane, hop, branch or ref - in which case
 * the second is the ordinary conflict.
 *
 * Only `declared` is raised. `unresolved` means the far end is not in the
 * catalog, and a trace showing the hop does not put it there.
 */
export function overlayFlow(existing: Flow, incoming: Flow): Flow | undefined {
  const lanes = (flow: Flow) => flow.participants.map((p) => p.id).join(" ");
  if (lanes(existing) !== lanes(incoming)) return undefined;

  const steps = overlayNodes(existing.steps, incoming.steps);
  if (!steps) return undefined;

  return { ...existing, steps };
}

function overlayNodes(
  existing: FlowNode[],
  incoming: FlowNode[],
): FlowNode[] | undefined {
  if (existing.length !== incoming.length) return undefined;
  const out: FlowNode[] = [];
  for (let i = 0; i < existing.length; i++) {
    const a = existing[i]!;
    const b = incoming[i]!;
    if (a.type !== b.type || a.id !== b.id) return undefined;
    switch (a.type) {
      case "step": {
        const step = b as Step;
        if (
          a.from !== step.from ||
          a.to !== step.to ||
          a.kind !== step.kind ||
          (a.ref ?? "") !== (step.ref ?? "")
        )
          return undefined;
        if (step.status === "verified" && a.status === "declared") {
          out.push({ ...a, status: "verified", note: a.note || step.note });
        } else {
          out.push(a);
        }
        break;
      }
      case "parallel": {
        const other = b as Parallel;
        if (a.branches.length !== other.branches.length) return undefined;
        const branches: FlowNode[][] = [];
        for (let j = 0; j < a.branches.length; j++) {
          const branch = overlayNodes(a.branches[j]!, other.branches[j]!);
          if (!branch) return undefined;
          branches.push(branch);
        }
        out.push({ ...a, branches });
        break;
      }
      case "alt": {
        const other = b as Alt;
        if (a.branches.length !== other.branches.length) return undefined;
        const branches: AltBranch[] = [];
        for (let j = 0; j < a.branches.length; j++) {
          const mine = a.branches[j]!;
          const theirs = other.branches[j]!;
          if (mine.title !== theirs.title) return undefined;
          const steps = overlayNodes(mine.steps, theirs.steps);
          if (!steps) return undefined;
          branches.push({ ...mine, steps });
        }
        out.push({ ...a, branches });
        break;
      }
      case "loop": {
        const other = b as Loop;
        if (a.title !== other.title) return undefined;
        const steps = overlayNodes(a.steps, other.steps);
        if (!steps) return undefined;
        out.push({ ...a, steps });
        break;
      }
    }
  }

  return out;
}

/**
 * Records who owns an id. Returns false when somebody already did, which is
 * how a duplicate is skipped rather than appended twice.
 */
function claim(
  owners: Map<string, string>,
  id: string,
  path: string,
  conflicts: MergeConflict[],
  kind: string,
): boolean {
  const owner = owners.get(id);
  if (owner === undefined) {
    owners.set(id, path);

    return true;
  }

  conflicts.push({
    path,
    where: id,
    message: `${kind} "${id}" is already declared in ${owner}; the one here is ignored`,
  });

  return false;
}

/**
 * The earliest instant among the stamps, returned as the string the source
 * itself wrote.
 *
 * Instants, not text. The corpus mixes offsets - the host writes `%cI`, so a
 * fragment stamped in Bangkok says `+07:00` and one stamped on a runner says
 * `Z` - and sorting ISO strings compares wall clocks while ignoring the offset
 * that says which wall. `2026-09-05T05:57:24+07:00` sorts after
 * `2026-09-05T00:00:00Z` and happened five hours before it.
 *
 * The winner keeps its own text rather than a normalised rendering of it,
 * because this string is displayed and a reader comparing the header against
 * the fragment on disk should find the same characters in both.
 *
 * A stamp nobody can parse does not win. It is not evidence of being old - it
 * is evidence of being broken - and the alternative, letting it sort first,
 * would date the whole estate from one corrupt file. It is still returned when
 * NOTHING parses, because then it is all there is to show, and a garbled date
 * on the page says "look at the stamps" where an empty one would fail the load
 * with "generatedAt is missing" about a stamp that is plainly present.
 */
function oldest(stamps: string[]): string {
  const known = stamps.filter(Boolean);
  const dated = known
    .map((iso) => ({ iso, at: Date.parse(iso) }))
    .filter((s) => !Number.isNaN(s.at))
    .sort((a, b) => a.at - b.at);

  return dated[0]?.iso ?? known[0] ?? "";
}

/**
 * What to show where a single commit used to be. One source keeps its sha; more
 * than one, all agreeing, keeps it too - and a genuine spread says so rather
 * than picking a winner and looking precise.
 *
 * The count is of distinct commits, not of files: twenty-eight fragments
 * written by one commit are one source of facts, and saying "28" would make a
 * reader think the estate came from twenty-eight places. A source nobody
 * stamped is not one of them.
 */
function describeCommits(stamps: SourceStamp[]): string {
  const commits = [...new Set(stamps.map((s) => s.commit).filter(Boolean))];
  if (commits.length === 1) return commits[0] ?? "";
  if (commits.length === 0) return "";

  return `${commits.length} sources`;
}

/** Every service in the merged catalog, flattened. Callers want this constantly. */
export function services(catalog: Catalog): Service[] {
  return catalog.contexts.flatMap((context) => context.services);
}
