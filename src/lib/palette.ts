// The command palette's index and its ranking. Pure: given a catalog and a
// query string it returns the rows to draw, so the ordering can be asserted in
// a test rather than eyeballed.
//
// Every row also carries the PROSE that belongs to it - a context's summary, a
// readme and the invariants written in it, an event's version notes, a field's
// doc line, the body of a decision. Names and ids are how you find a thing you
// can already name; prose is how you find the thing you can only describe
// ("the rule about two currencies in one order"). It is the last tier the
// scorer tries, so a prose hit never displaces a name, and a hit brings its
// own line of context back with it - a row that matched on something the
// reader cannot see is a row they have to open to understand.

import type {
  Block,
  Catalog,
  Event,
  Field,
  Flow,
  HttpRoute,
  Service,
} from "../catalog";
import { allTerms, enumsOf, walkSteps } from "../catalog";
import { flowHealth } from "./flow-tree";
import { parseQuery } from "./kinds";
import type { Kind, ParsedQuery } from "./kinds";
import { paths, storePath, tablePath, viewPath } from "../routes";

/**
 * Markdown, flattened to one line of searchable prose.
 *
 * Fenced code is dropped whole: a readme's Go snippet would match half the
 * catalog's identifiers and answer nothing. The remaining marks are stripped
 * rather than parsed - `**never**` must be found by typing "never", and an
 * excerpt is a sentence, not a rendering.
 */
export function flattenProse(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[`*_#>|[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Everything a field says about itself, for the row that owns the field. */
function fieldProse(fields: readonly Field[] | undefined): string {
  return (fields ?? []).map((f) => `${f.name} ${f.doc}`).join(" ");
}

function eventProse(event: Event): string {
  return event.versions
    .map((v) => `${v.doc} ${fieldProse(v.fields)}`)
    .join(" ");
}

function blockProse(block: Block): string {
  return `${block.doc} ${fieldProse(block.fields)}`;
}

export interface PaletteItem {
  kind: Kind;
  /**
   * The catalog id of the thing. Rows are keyed by kind AND id downstream: a
   * term's id has the same shape as a service's - `<context>.<name>` - so a
   * context with a service called `billing` and a word called Billing would
   * otherwise be two rows fighting over one key.
   */
  id: string;
  /**
   * The catalog id to SELECT when picking this row, for the kinds the
   * selection model knows. Rows without one only navigate: a value object,
   * a command and a decision have pages but are not selectable entities.
   */
  selectId?: string;
  /** What is matched and shown first. */
  name: string;
  /** Where it lives - owner id, or the summary for flows and decisions. */
  detail: string;
  /** The page that owns the row, or null when it has none (shared types). */
  path: string | null;
  /** Context colour to paint with, or null for org-wide rows. */
  context: string | null;
  /** Right-aligned extra, e.g. an event's latest version. */
  badge?: string;
  /**
   * Names the row is also known by, searched after its own and before its
   * prose: for a flow, the lanes it runs through and the labels and refs of
   * its steps, so "GetQuote" finds the flow that makes that call.
   */
  keywords?: string[];
  /**
   * The row's own prose, flattened to one line. Searched last, and only for
   * terms long enough to mean something; a row with nothing written about it
   * simply leaves it out.
   */
  text?: string;
  /**
   * The HTTP route the row answers to: for an endpoint, the one it serves; for
   * a flow, the one that starts it. A reader holding a URL out of a log is
   * looking for exactly this, and a pasted `/v1/users/42` is matched against
   * it rather than against any name.
   */
  route?: PaletteRoute;
  /**
   * For an endpoint: the flows its route starts, so a hit answers "and then
   * what happens" without a second search. Rows of kind `flow`, drawn under
   * the endpoint as options of their own.
   */
  flows?: PaletteItem[];
}

/** A route, and the service that serves it. */
export interface PaletteRoute extends HttpRoute {
  service: string;
}

/** The query param the spec tab reads to open one operation. */
export const OPERATION_PARAM = "op";

/** `POST /v1/users`, or the path alone when no verb was proven. */
export function routeLabel(route: HttpRoute): string {
  return `${route.method} ${route.path}`.trim();
}

const VERBS = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
  "TRACE",
]);

/**
 * A query that is a request rather than a name: `/search`, `GET /v1/users/42`,
 * or a URL pasted whole out of a browser or a log. Null for anything else, so
 * name search is untouched by all of this.
 */
export interface PathQuery {
  /** Upper case, or null when the query named no verb. */
  method: string | null;
  /** The path's segments, host and query string gone: `/a/b` is `["a", "b"]`. */
  segments: string[];
}

export function parsePathQuery(term: string): PathQuery | null {
  let rest = term.trim();
  let method: string | null = null;
  const verb = /^([A-Za-z]+)\s+(\S.*)$/.exec(rest);
  if (verb && VERBS.has((verb[1] ?? "").toUpperCase())) {
    method = (verb[1] ?? "").toUpperCase();
    rest = (verb[2] ?? "").trim();
  }
  // A pasted URL: the scheme and host say where it was sent, not what answered
  // it, and the catalog records routes without either.
  const url = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*(.*)$/i.exec(rest);
  if (url) rest = url[1] || "/";
  if (!rest.startsWith("/")) return null;
  rest = rest.replace(/[?#].*$/, "");
  const segments = rest
    .slice(1)
    .split("/")
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });
  return { method, segments };
}

/** A route segment as a test: `{id}` and `:id` stand for any one segment. */
function segmentPattern(segment: string): RegExp {
  if (/^:[^/]+$/.test(segment)) return /^[^/]+$/;
  const source = segment
    .split(/(\{[^}]*\})/)
    .map((part) =>
      /^\{[^}]*\}$/.test(part) ? "[^/]+" : escapeRegex(part),
    )
    .join("");
  return new RegExp(`^${source}$`, "i");
}

function isTemplated(segment: string): boolean {
  return /^:/.test(segment) || /\{[^}]*\}/.test(segment);
}

/**
 * How well a request matches a route, lower is better, null for no match.
 *
 * 0 - every segment matches and none needed a template: the literal route.
 * 0.5 - every segment matches, some through `{id}`: `/v1/users/42`. After the
 *   literal, so `/v1/sessions/current` puts the route spelled that way above a
 *   `/v1/sessions/{id}` that would also take it.
 * 1 - the request is the start of the route, the last segment still being
 *   typed: `/v1/bas` while the reader is on their way to `/v1/baskets`.
 *   Plus a tenth per segment still to come, so the nearest route leads.
 *
 * A verb in the query must agree with the route's; a route whose verb nobody
 * proved takes any.
 */
export function matchRoute(query: PathQuery, route: HttpRoute): number | null {
  if (query.method && route.method && query.method !== route.method.toUpperCase())
    return null;
  const target = route.path.replace(/^\/+/, "").split("/");
  let wanted = query.segments;
  // A trailing slash on an otherwise whole path is the same path.
  if (
    wanted.length === target.length + 1 &&
    wanted[wanted.length - 1] === ""
  )
    wanted = wanted.slice(0, -1);
  if (wanted.length > target.length) return null;

  let templated = false;
  for (let i = 0; i < wanted.length - 1; i++) {
    const want = wanted[i] ?? "";
    const have = target[i] ?? "";
    if (!segmentPattern(have).test(want)) return null;
    if (isTemplated(have)) templated = true;
  }

  const lastWanted = wanted[wanted.length - 1] ?? "";
  const lastHave = target[wanted.length - 1] ?? "";
  const whole = wanted.length === target.length;
  if (whole && segmentPattern(lastHave).test(lastWanted)) {
    return templated || isTemplated(lastHave) ? 0.5 : 0;
  }
  // Still typing: the last segment is a prefix of a literal one, or anything
  // at all where the route takes a parameter.
  const typing =
    lastWanted === "" ||
    isTemplated(lastHave) ||
    lastHave.toLowerCase().startsWith(lastWanted.toLowerCase());
  return typing ? 1 + Math.min(target.length - wanted.length, 9) / 10 : null;
}

/**
 * The route that starts a flow, or undefined. A flow opens with a call to one
 * operation; when that operation has a route, the route is what starts the
 * flow. A flow whose trigger is recorded as something other than HTTP is not
 * started by a URL whatever its first step looks like.
 */
function flowRoute(
  flow: Flow,
  services: ReadonlyMap<string, Service>,
): PaletteRoute | undefined {
  if (flow.trigger && flow.trigger.kind !== "http") return undefined;
  const opening = walkSteps(flow.steps)[0];
  if (!opening || opening.kind !== "rpc") return undefined;
  const service = services.get(opening.to);
  for (const provided of service?.provides ?? []) {
    for (const method of provided.methods) {
      if (!method.http) continue;
      if (
        opening.ref === `${provided.id}/${method.name}` ||
        (!opening.ref && opening.label === method.name)
      )
        return { ...method.http, service: opening.to };
    }
  }
  // A step labelled with the request itself - `POST /webhooks/psp/v2` - names
  // its route even when the service's document is not in the catalog.
  const spelled = opening.label ? parsePathQuery(opening.label) : null;
  if (spelled?.method)
    return {
      method: spelled.method,
      path: `/${spelled.segments.join("/")}`,
      service: opening.to,
    };
  return undefined;
}

function sameRoute(a: PaletteRoute, b: PaletteRoute): boolean {
  return (
    a.service === b.service &&
    a.method.toUpperCase() === b.method.toUpperCase() &&
    a.path === b.path
  );
}

/** Every navigable thing in the catalog, built once at module load. */
export function paletteItems(catalog: Catalog): PaletteItem[] {
  const items: PaletteItem[] = [];

  for (const context of catalog.contexts) {
    items.push({
      kind: "context",
      id: context.id,
      selectId: context.id,
      name: context.id,
      detail: context.name,
      path: paths.context(context.id),
      context: context.id,
      text: flattenProse(`${context.name} ${context.summary}`),
    });

    for (const service of context.services) {
      items.push({
        kind: "service",
        id: service.id,
        selectId: service.id,
        name: service.slug,
        detail: service.id,
        path: paths.service(context.id, service.slug),
        context: context.id,
        text: flattenProse(`${service.name} ${service.readme}`),
      });

      for (const aggregate of service.aggregates) {
        items.push({
          kind: "aggregate",
          id: aggregate.id,
          selectId: aggregate.id,
          name: aggregate.name,
          detail: service.id,
          path: paths.aggregate(context.id, service.slug, aggregate.slug),
          context: context.id,
          badge: `root: ${aggregate.root}`,
          // The readme is where the invariants live, and an invariant is the
          // one fact about an aggregate nobody can guess the name of.
          text: flattenProse(`${aggregate.name} ${aggregate.readme}`),
        });

        for (const event of aggregate.events) {
          const latest = event.versions[event.versions.length - 1];
          items.push({
            kind: "event",
            id: event.id,
            selectId: event.id,
            name: event.name,
            detail: aggregate.id,
            path: paths.event(
              context.id,
              service.slug,
              aggregate.slug,
              event.slug,
            ),
            context: context.id,
            ...(latest ? { badge: latest.version } : {}),
            text: flattenProse(eventProse(event)),
          });
        }

        for (const vo of aggregate.valueObjects) {
          items.push({
            kind: "vo",
            id: vo.id,
            name: vo.name,
            detail: aggregate.id,
            path: paths.valueObject(
              context.id,
              service.slug,
              aggregate.slug,
              vo.slug,
            ),
            context: context.id,
            text: flattenProse(blockProse(vo)),
          });
        }

        for (const item of enumsOf(aggregate)) {
          items.push({
            kind: "enum",
            id: item.id,
            name: item.name,
            detail: aggregate.id,
            path: paths.enum(
              context.id,
              service.slug,
              aggregate.slug,
              item.slug,
            ),
            context: context.id,
            // The values are what a reader remembers - "the one with
            // CARD_REFUSED" - so they are searchable, docs and all.
            text: flattenProse(
              `${item.doc} ${item.values.map((v) => `${v.name} ${v.doc}`).join(" ")}`,
            ),
          });
        }

        for (const entity of aggregate.entities) {
          items.push({
            kind: "entity",
            id: entity.id,
            name: entity.name,
            detail: aggregate.id,
            path: paths.entity(
              context.id,
              service.slug,
              aggregate.slug,
              entity.slug,
            ),
            context: context.id,
            ...(entity.name === aggregate.root ? { badge: "root" } : {}),
            text: flattenProse(blockProse(entity)),
          });
        }

        // Commands and queries have no page of their own; they land on the
        // aggregate that handles them, at the right section.
        for (const op of aggregate.operations) {
          items.push({
            kind: op.kind,
            id: `${aggregate.id}#${op.id}`,
            name: op.id,
            detail: aggregate.id,
            path: `${paths.aggregate(context.id, service.slug, aggregate.slug)}#bb-${op.kind === "command" ? "commands" : "queries"}`,
            context: context.id,
            ...(op.doc ? { text: flattenProse(op.doc) } : {}),
          });
        }
      }

      // Endpoints hang off the service rather than an aggregate: one of them
      // can run use cases from two of them. They have no page of their own
      // either, so they land on the tab that lists them - or, for one with a
      // route, on that operation in the service's document, which is what a
      // reader holding the URL came to read.
      for (const provided of service.provides) {
        for (const method of provided.methods) {
          const servicePage = paths.service(context.id, service.slug);
          items.push({
            kind: "endpoint",
            id: `${provided.id}/${method.name}`,
            name: method.name,
            detail: provided.id,
            path: method.http
              ? `${servicePage}?tab=spec&${OPERATION_PARAM}=${encodeURIComponent(routeLabel(method.http))}`
              : `${servicePage}?tab=provides`,
            context: context.id,
            ...(method.http
              ? { route: { ...method.http, service: service.id } }
              : {}),
          });
        }
      }
    }
  }

  // Shared types have no page: picking one opens the detail panel where it is.
  // They are listed all the same, because "which events carry a Money?" is a
  // question people arrive with.
  for (const [id, def] of Object.entries(catalog.defs)) {
    items.push({
      kind: "def",
      id: `def:${id}`,
      selectId: id,
      name: id,
      detail: "shared type",
      path: null,
      context: null,
      badge: `${def.fields.length}f`,
      text: flattenProse(fieldProse(def.fields)),
    });
  }

  // Schema modules. Found by the name a reader pastes into a buf.yaml, and by
  // the packages inside them — "which module declares shop.v1?" is a question
  // people arrive with, and the module page is the only thing that answers it.
  for (const module of catalog.modules ?? []) {
    items.push({
      kind: "module",
      id: module.id,
      selectId: module.id,
      name: module.name,
      detail: module.registry ?? "not published",
      path: paths.module(module.slug),
      context: null,
      badge: module.commit ? module.commit.slice(0, 7) : undefined,
      text: flattenProse(module.packages.join(" ")),
    });
  }

  // Stores and tables. A table is the one row here whose name a reader is
  // likely to know exactly — they have just read it in a migration or a stack
  // trace — so it is worth finding by name alone, without the store.
  for (const store of catalog.stores ?? []) {
    const to = storePath(store.id);
    const context = store.owner.split(".")[0] ?? null;
    items.push({
      kind: "store",
      id: store.id,
      selectId: store.id,
      name: store.slug,
      detail: store.owner,
      path: to,
      context,
      badge: store.kind,
      text: flattenProse(`${store.name} ${store.source ?? ""}`),
    });

    for (const table of store.tables) {
      items.push({
        kind: "table",
        id: table.id,
        selectId: table.id,
        name: table.name,
        detail: store.id,
        path: tablePath(table.id),
        context,
        ...(table.role ? { badge: table.role } : {}),
        text: flattenProse(
          `${table.doc ?? ""} ${table.columns.map((c) => c.name).join(" ")}`,
        ),
      });
    }

    // A view is searched by its SQL as well as by its columns: half the time
    // the reader remembers the join, not the name the migration gave it.
    for (const view of store.views ?? []) {
      items.push({
        kind: "view",
        id: view.id,
        selectId: view.id,
        name: view.name,
        detail: store.id,
        path: viewPath(view.id),
        context,
        badge: view.materialized ? "matview" : "view",
        text: flattenProse(
          `${view.doc ?? ""} ${view.definition ?? ""} ${view.columns
            .map((c) => c.name)
            .join(" ")}`,
        ),
      });
    }
  }

  // A third party has no context and no tree row: the palette is the one way
  // to its page besides a call that names it.
  for (const external of catalog.externals ?? []) {
    items.push({
      kind: "external",
      id: external.id,
      name: external.name,
      detail: "outside the estate",
      path: paths.external(external.slug),
      context: null,
      keywords: external.provides.map((provided) => provided.id),
      text: flattenProse(external.summary),
    });
  }

  const services = new Map(
    catalog.contexts.flatMap((context) =>
      context.services.map((service) => [service.id, service] as const),
    ),
  );
  const flowItems: PaletteItem[] = [];
  for (const flow of catalog.flows) {
    const keywords = new Set<string>();
    for (const p of flow.participants) keywords.add(p.id);
    for (const step of walkSteps(flow.steps)) {
      if (step.label) keywords.add(step.label);
      if (step.ref) keywords.add(step.ref);
    }
    const route = flowRoute(flow, services);
    const item: PaletteItem = {
      kind: "flow",
      id: flow.id,
      name: flow.slug,
      detail: flow.name,
      path: paths.flow(flow.slug),
      context: null,
      badge: flowHealth(flow),
      keywords: [...keywords],
      text: flattenProse(`${flow.name} ${flow.summary}`),
      ...(route ? { route } : {}),
    };
    items.push(item);
    flowItems.push(item);
  }

  // The other half of the link: an endpoint knows the flows its route starts.
  for (const endpoint of items) {
    if (endpoint.kind !== "endpoint" || !endpoint.route) continue;
    const route = endpoint.route;
    const started = flowItems.filter(
      (flow) => flow.route && sameRoute(flow.route, route),
    );
    if (started.length > 0) endpoint.flows = started;
  }

  // Last, because a term is what everything above is CALLED rather than a
  // thing to open. A reader who typed a word and got the sentence explaining
  // it before the aggregate named after it would have to scroll past the
  // dictionary to reach the model.
  for (const term of allTerms(catalog)) {
    items.push({
      kind: "term",
      id: term.id,
      name: term.name,
      detail: term.context,
      // The page, showing this word. A term has no page of its own - it is one
      // paragraph, and a route per paragraph is a route nobody can hold in
      // their head.
      path: paths.term(term.id),
      context: term.context,
      text: flattenProse(term.definition),
    });
  }

  for (const adr of catalog.adrs) {
    items.push({
      kind: "adr",
      id: adr.id,
      name: adr.id,
      detail: adr.title,
      path: paths.adr(adr.slug),
      context: adr.scope.kind === "context" ? adr.scope.context : null,
      badge: adr.status,
      text: flattenProse(`${adr.title} ${adr.body}`),
    });
  }

  for (const rfc of catalog.rfcs ?? []) {
    items.push({
      kind: "rfc",
      id: rfc.id,
      name: rfc.displayId,
      detail: rfc.title,
      path: paths.rfc(rfc.slug),
      context: rfc.scope.kind === "context" ? rfc.scope.context : null,
      badge: rfc.status,
      text: flattenProse(`${rfc.title} ${rfc.body}`),
    });
  }

  return items;
}

/**
 * Lower is better. Exact beats prefix beats a match at a word boundary beats
 * anything else, and the id is only consulted once the name has failed, so
 * typing "money" puts the value objects called Money above the events that
 * merely carry one.
 */
export function score(
  item: PaletteItem,
  term: string,
  request: PathQuery | null = parsePathQuery(term),
): number | null {
  if (!term) return 0;
  // A request is answered by routes first, on the same scale as names: the
  // route spelled as typed ranks with an exact name, the one still being typed
  // towards with a name prefix. Everything else still gets its usual chance,
  // so a flow step labelled with the path is found the way it always was.
  if (request && item.route) {
    const matched = matchRoute(request, item.route);
    if (matched !== null) return matched;
  }
  const needle = term.toLowerCase();
  const name = item.name.toLowerCase();
  // A pasted id is the other exact answer: `shop.oms` is the service, not the
  // decisions whose names begin with it.
  if (name === needle || item.id.toLowerCase() === needle) return 0;
  if (name.startsWith(needle)) return 1;
  // A word boundary is a case change or one of . / - _ ; "item" should hit
  // "AddItem" and "line-item" but not rank with a mid-word accident.
  if (new RegExp(`(^|[.\\-_/ ])${escapeRegex(needle)}`).test(name)) return 2;
  if (
    /[a-z]/.test(item.name) &&
    new RegExp(`[a-z]${escapeRegex(term)}`).test(item.name)
  )
    return 2;
  if (name.includes(needle)) return 3;
  if (item.id.toLowerCase().includes(needle)) return 4;
  if (item.detail.toLowerCase().includes(needle)) return 5;
  if (keywordHit(item, needle)) return KEYWORD_SCORE;
  // Last, and only for a term with something to say. Two characters match
  // prose everywhere and rank nothing; the floor is what stops "or" from
  // returning the whole estate under the rows that actually answered.
  if (
    term.length >= PROSE_MIN &&
    item.text &&
    item.text.toLowerCase().includes(needle)
  )
    return PROSE_SCORE;
  return null;
}

/** The first keyword the term is found in, or undefined. */
function keywordHit(item: PaletteItem, needle: string): string | undefined {
  if (needle.length < PROSE_MIN) return undefined;
  return item.keywords?.find((k) => k.toLowerCase().includes(needle));
}

/** The score a keyword hit returns; it owes an excerpt naming the keyword. */
const KEYWORD_SCORE = 6;

/** Shortest term the prose tier will answer. Below it, names only. */
const PROSE_MIN = 3;

/** How much of the sentence around a hit comes back with it. */
const LEAD = 32;
const TRAIL = 56;

/**
 * The words around a prose hit, cut to fit one row.
 *
 * Returned as three parts rather than one string so the caller can mark the
 * match without parsing its own output back apart - and so a term containing
 * regex punctuation is never a regex.
 */
export interface Excerpt {
  before: string;
  match: string;
  after: string;
}

export function excerptOf(text: string, term: string): Excerpt | null {
  if (!term) return null;
  const at = text.toLowerCase().indexOf(term.toLowerCase());
  if (at < 0) return null;

  const end = at + term.length;
  // Cut at a space where there is one nearby, so an excerpt starts on a word
  // rather than in the middle of one.
  let from = Math.max(0, at - LEAD);
  if (from > 0) {
    const space = text.indexOf(" ", from);
    if (space >= 0 && space < at) from = space + 1;
  }
  let to = Math.min(text.length, end + TRAIL);
  if (to < text.length) {
    const space = text.lastIndexOf(" ", to);
    if (space > end) to = space;
  }

  return {
    before: (from > 0 ? "…" : "") + text.slice(from, at),
    match: text.slice(at, end),
    after: text.slice(end, to) + (to < text.length ? "…" : ""),
  };
}

function escapeRegex(raw: string): string {
  return raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Kinds first in this order when scores tie: the model before the paperwork. */
const KIND_RANK: Record<Kind, number> = {
  event: 0,
  aggregate: 1,
  vo: 2,
  entity: 3,
  service: 4,
  context: 5,
  external: 5,
  command: 6,
  query: 7,
  // After the operation it exposes: a reader searching for "register" wants
  // the command first and the door to it second.
  endpoint: 8,
  // A set of values after the shapes that hold it and the calls that move
  // it: "status" wants the lifecycle's aggregate before the enum's list.
  enum: 9,
  def: 9,
  // A module is a contract, so it sits with the shared types rather than with
  // the infrastructure: what it holds is shapes other services are promised.
  module: 10,
  // Where the model is kept comes after the model itself: a reader looking for
  // "orders" wants the aggregate first and the table that holds it second.
  store: 11,
  table: 12,
  // A view after the tables it is computed from, for the same reason.
  view: 13,
  flow: 14,
  adr: 15,
  rfc: 15,
  // Last, and on purpose. A reader typing "session" wants the aggregate they
  // can open, not the sentence about what the word means; the term is what
  // they fall back to when nothing they clicked explained it.
  term: 16,
};

/**
 * One row of the result list. A hit is not the same thing as an index row: it
 * knows WHY it is here, which is the whole difference between a name match and
 * a match on something written three paragraphs into a readme.
 */
export interface PaletteHit {
  item: PaletteItem;
  /** Set only when the term was found in prose and nowhere shorter. */
  excerpt?: Excerpt;
}

export interface PaletteResult extends ParsedQuery {
  hits: PaletteHit[];
  /** Matches dropped by the limit, so the palette can say so. */
  truncated: number;
}

/** The score the prose tier returns; the other tier that owes an excerpt. */
const PROSE_SCORE = 7;

export function search(
  items: PaletteItem[],
  raw: string,
  limit = 40,
): PaletteResult {
  const parsed = parseQuery(raw);
  const request = parsePathQuery(parsed.term);
  const scored: { item: PaletteItem; score: number }[] = [];

  for (const item of items) {
    if (parsed.kind && item.kind !== parsed.kind) continue;
    const s = score(item, parsed.term, request);
    if (s === null) continue;
    scored.push({ item, score: s });
  }

  scored.sort(
    (a, b) =>
      a.score - b.score ||
      KIND_RANK[a.item.kind] - KIND_RANK[b.item.kind] ||
      a.item.name.length - b.item.name.length ||
      a.item.name.localeCompare(b.item.name) ||
      a.item.id.localeCompare(b.item.id),
  );

  // Asked by request, a flow that is already drawn under the endpoint that
  // starts it is not listed again on its own: the same row twice reads as two
  // flows. Any other query keeps every row it matched.
  const underEndpoint = new Set(
    request
      ? scored.flatMap(({ item }) =>
          item.kind === "endpoint" ? (item.flows ?? []) : [],
        )
      : [],
  );
  const listed = scored.filter(({ item }) => !underEndpoint.has(item));

  const hits = listed.slice(0, limit).map(({ item, score: s }) => {
    // A flow found by the request says which route started it: its name is a
    // slug the reader did not type, and the route is why it answered.
    if (
      request &&
      item.kind === "flow" &&
      item.route &&
      matchRoute(request, item.route) !== null
    )
      return {
        item,
        excerpt: { before: "started by ", match: routeLabel(item.route), after: "" },
      };
    if (s === KEYWORD_SCORE) {
      const keyword = keywordHit(item, parsed.term.toLowerCase());
      return keyword
        ? { item, excerpt: { before: "runs through ", match: keyword, after: "" } }
        : { item };
    }
    if (s !== PROSE_SCORE || !item.text) return { item };
    const excerpt = excerptOf(item.text, parsed.term);
    return excerpt ? { item, excerpt } : { item };
  });

  return {
    ...parsed,
    hits,
    truncated: Math.max(0, listed.length - limit),
  };
}
