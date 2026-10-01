// How the catalog is spelled in LikeC4: the identifiers a model line or a
// view refers to, and the words a box or an arrow carries.

import reserved from "../../src/likec4/reserved.json" with { type: "json" };

// --- ids (mirrors src/likec4/ids.ts; kept in step by src/likec4/ids.test.ts) ---
// The reserved words are not mirrored, they are the same file: a word the
// grammar has taken must be escaped identically on both sides or a clicked
// node stops finding what it stands for.
const RESERVED = new Set(reserved);
export const safeId = (raw) => {
  const cleaned = raw.replace(/[^A-Za-z0-9_]/g, "_");
  return /^[0-9]/.test(cleaned) || RESERVED.has(cleaned)
    ? `_${cleaned}`
    : cleaned;
};

/** The spellings that depend on the catalog: a store is a child of the service that owns it. */
export function catalogIds(catalog) {
  // Mirrors storeFqn in ids.ts; catalog ids and ownership stay unchanged.
  const storeRefs = new Map((catalog.stores ?? []).map((store) => [
    store.id,
    `${store.owner.split(".").slice(0, -1).map(safeId).join(".")}._store_${safeId(store.id)}`,
  ]));
  const fqn = (id) => storeRefs.get(id) ?? id.split(".").map(safeId).join(".");
  return { fqn };
}

export const flowViewId = (flow) => `flow_${safeId(flow.slug)}`;
export const flowCrossViewId = (flow) => `${flowViewId(flow)}_cross`;
export const contextViewId = (c) => `ctx_${safeId(c.id)}`;
export const serviceViewId = (s) => `svc_${safeId(s.id)}`;
export const serviceInsideViewId = (s) => `${serviceViewId(s)}_inside`;
export const deploymentViewId = (environment) => `deploy_${safeId(environment)}`;
export const serviceDeployViewId = (s) => `deploy_svc_${safeId(s.id)}`;
export const LANDSCAPE_VIEW = "landscape";
export const CONTAINERS_VIEW = "containers";
export const profileLandscapeViewId = (profile) =>
  `${LANDSCAPE_VIEW}_${safeId(profile.id)}`;
export const profileContainersViewId = (profile) =>
  `${CONTAINERS_VIEW}_${safeId(profile.id)}`;
export const includeTargets = (targets) =>
  targets.length > 0 ? targets.join(", ") : "*";

export const q = (text) =>
  `'${String(text).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

// An arrow's label says what the relation does, in the direction it points:
// `publishes OrderPlaced`, not a bare `OrderPlaced` a reader has to turn round.
// A label that already opens with a verb — a flow step's `enqueue send_email`
// — keeps its own; a bare name is given the relation's.
export const withVerb = (verb, name) => (/^[a-z]+ /.test(name) ? name : `${verb} ${name}`);
export const counted = (verb, count, noun) => `${verb} ${count} ${noun}${count === 1 ? "" : "s"}`;

// The protocol a call travels on, read off the document that declares it.
// Mirrors sourceDocKind in src/lib/source-doc.ts, plus the generated stub a
// Go client is read from when no proto is vendored. Empty when the source
// says nothing a reader could name.
export const protocolOf = (source) => {
  const path = String(source ?? "")
    .replace(/:\d+$/, "")
    .toLowerCase();
  if (path.endsWith(".proto") || path.endsWith(".pb.go")) return "gRPC";
  if (path.endsWith(".wsdl")) return "SOAP";
  if (path.endsWith(".graphql") || path.endsWith(".graphqls")) return "GraphQL";
  if (/\.(ya?ml|json)$/.test(path)) return "HTTP";
  return "";
};

// What a box says it does: the first sentence of the first paragraph of prose.
// A README opens with a title and, often, a line saying which service it is -
// "Service `cart` - bounded context shop. TypeScript on Node.js." - which names
// the service by its code name and says nothing of what it does; that line is
// passed over. Markdown is taken out, and a sentence past 200 characters is cut
// at a word. Nothing is said when no paragraph qualifies.
export function ledeOf(markdown, slug = "") {
  const paragraphs = String(markdown ?? "").replace(/\r/g, "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  for (const paragraph of paragraphs) {
    if (/^(#|```|~~~|<|!\[|\||[-*+] |\d+\. |>)/.test(paragraph)) continue;
    const words = paragraph.split(/\s+/).length;
    if (words < 3) continue;
    if (slug && paragraph.includes(`\`${slug}\``) && words < 25) continue;
    return firstSentence(plainText(paragraph));
  }
  return "";
}
function plainText(markdown) {
  return markdown
    .replace(/\s+/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|[\s(])[*_](\S(?:.*?\S)?)[*_](?=[\s.,;:!?)]|$)/g, "$1$2")
    .trim();
}
function firstSentence(text) {
  const sentence = /^(.+?[.!?])(?=\s|$)/.exec(text)?.[1] ?? text;
  if (sentence.length <= 200) return sentence;
  const cut = sentence.slice(0, 200);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 0 ? cut.lastIndexOf(" ") : 200)}…`;
}

// What a container box says under its name at level 2: what the service is
// built with when an extractor recorded it, and what it speaks, read off the
// contracts it provides. Both are facts the catalog holds; neither is guessed.
export const technologyOf = (service) => {
  const protocols = new Set(
    service.provides
      .map((provided) => protocolOf(provided.source))
      .filter(Boolean),
  );
  return [...(service.technologies ?? []), ...[...protocols].sort()].join(
    " · ",
  );
};
