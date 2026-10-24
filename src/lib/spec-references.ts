import type { CatalogIndex, ChangeSpec } from "../catalog";
import { looksLikePath, splitLine } from "./source-link";
import { pathForId } from "../app/canonical";
import { paths, specRequirementAnchor, specTaskAnchor } from "../routes";

export type ExactReferenceKind = "url" | "catalog-id" | "typed-slug" | "source" | "requirement" | "task";

export type ExactReference =
  | { raw: string; status: "resolved"; kind: ExactReferenceKind; href?: string; source?: string; targetId?: string }
  | { raw: string; status: "unresolved"; kind: Exclude<ExactReferenceKind, "url">; reason: string };

export interface SpecReferenceContext {
  spec: ChangeSpec;
  index: CatalogIndex;
  knownPaths: ReadonlySet<string>;
}

const TYPED = /^(flow|adr|rfc|spec|module|external|service|context):([A-Za-z0-9][A-Za-z0-9._/-]*)$/;
const CATALOG_ID = /^[A-Za-z0-9][A-Za-z0-9._/-]*[./][A-Za-z0-9._/-]+$/;

function typedSlug(kind: string, slug: string, index: CatalogIndex): { href: string; targetId: string } | undefined {
  if (kind === "flow") { const found = index.flowBySlug.get(slug); return found ? { href: paths.flow(slug), targetId: found.id } : undefined; }
  if (kind === "adr") { const found = index.adrBySlug.get(slug); return found ? { href: paths.adr(slug), targetId: found.id } : undefined; }
  if (kind === "rfc") { const found = index.rfcBySlug.get(slug); return found ? { href: paths.rfc(slug), targetId: found.id } : undefined; }
  if (kind === "spec") { const found = index.specBySlug.get(slug); return found ? { href: paths.spec(slug), targetId: found.id } : undefined; }
  if (kind === "module") { const found = index.moduleBySlug.get(slug); return found ? { href: paths.module(slug), targetId: found.id } : undefined; }
  if (kind === "external") {
    const found = [...index.externalById.values()].filter((item) => item.slug === slug);
    return found.length === 1 ? { href: paths.external(slug), targetId: found[0]!.id } : undefined;
  }
  if (kind === "service") {
    const found = [...index.serviceById.values()].filter((service) => service.slug === slug);
    if (found.length !== 1) return undefined;
    const context = index.serviceContext.get(found[0]!.id);
    return context ? { href: paths.service(context.id, slug), targetId: found[0]!.id } : undefined;
  }
  if (kind === "context") {
    const found = index.catalog.contexts.find((context) => context.slug === slug);
    return found ? { href: paths.context(found.id), targetId: found.id } : undefined;
  }
  return undefined;
}

export function knownSpecPaths(spec: ChangeSpec): Set<string> {
  const paths = new Set<string>();
  const add = (where: string) => {
    const path = splitLine(where).path.replace(/^\.\//, "");
    if (path) paths.add(path);
  };
  add(spec.source);
  for (const artifact of spec.artifacts) add(artifact.path);
  for (const requirement of spec.requirements) add(requirement.source);
  for (const task of spec.tasks) add(task.source);
  return paths;
}

/** Resolve one explicit token. Ordinary prose returns null and stays prose. */
export function resolveSpecReference(raw: string, context: SpecReferenceContext): ExactReference | null {
  const value = raw.trim();
  if (!value || value !== raw) return null;

  try {
    const url = new URL(value);
    if (url.protocol === "http:" || url.protocol === "https:") return { raw, status: "resolved", kind: "url", href: value };
  } catch { /* not an absolute URL */ }

  const requirement = context.spec.requirements.find((item) => item.id === value);
  if (requirement) return { raw, status: "resolved", kind: "requirement", href: `#${specRequirementAnchor(requirement.id)}` };
  const task = context.spec.tasks.find((item) => item.id === value);
  if (task) return { raw, status: "resolved", kind: "task", href: `#${specTaskAnchor(task.id)}` };

  const typed = TYPED.exec(value);
  if (typed) {
    const target = typedSlug(typed[1]!, typed[2]!, context.index);
    return target
      ? { raw, status: "resolved", kind: "typed-slug", ...target }
      : { raw, status: "unresolved", kind: "typed-slug", reason: `No ${typed[1]} has the exact slug ${typed[2]}` };
  }

  const catalogHref = pathForId(context.index, value);
  if (catalogHref) return { raw, status: "resolved", kind: "catalog-id", href: catalogHref, targetId: value };

  const { path } = splitLine(value);
  if (looksLikePath(path)) {
    return context.knownPaths.has(path.replace(/^\.\//, ""))
      ? { raw, status: "resolved", kind: "source", source: value }
      : { raw, status: "unresolved", kind: "source", reason: `No known source path matches ${path}` };
  }

  if (CATALOG_ID.test(value)) return { raw, status: "unresolved", kind: "catalog-id", reason: `No catalog entity has the exact ID ${value}` };
  return null;
}

/** Inline-code tokens are the explicit references embedded in authored prose. */
export function referencesIn(text: string, context: SpecReferenceContext): ExactReference[] {
  const out: ExactReference[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(/`([^`\n]+)`/g)) {
    const reference = resolveSpecReference(match[1]!, context);
    if (!reference) continue;
    const key = `${reference.kind}:${reference.raw}`;
    if (!seen.has(key)) { seen.add(key); out.push(reference); }
  }
  return out;
}

export function unresolvedSpecReferences(spec: ChangeSpec, context: SpecReferenceContext): ExactReference[] {
  const texts = [
    ...spec.artifacts.map((artifact) => artifact.body),
    ...spec.requirements.flatMap((requirement) => [requirement.title, requirement.text, ...requirement.scenarios.flatMap((scenario) => [scenario.name, ...scenario.when, ...scenario.then])]),
    ...spec.tasks.map((task) => task.title),
  ];
  const found = texts.flatMap((text) => referencesIn(text, context)).filter((reference) => reference.status === "unresolved");
  return [...new Map(found.map((reference) => [`${reference.kind}:${reference.raw}`, reference])).values()];
}
