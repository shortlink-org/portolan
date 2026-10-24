import type { ReactNode } from "react";
import { Link } from "react-router";
import { allRepos } from "../catalog";
import { catalog } from "../data";
import type { SpecReferenceContext } from "../lib/spec-references";
import { resolveSpecReference } from "../lib/spec-references";
import { sourceLocation } from "../lib/source-link";
import { SourcePreviewLink } from "./SourcePreview";

export function SpecReference({ value, context }: { value: string; context: SpecReferenceContext }) {
  const reference = resolveSpecReference(value, context);
  if (!reference) return <code>{value}</code>;
  if (reference.status === "unresolved") {
    return <code className="border-b border-dotted border-unresolved text-unresolved" title={reference.reason}>{value}</code>;
  }
  if (reference.kind === "source" && reference.source) {
    const location = sourceLocation(reference.source, null, allRepos(catalog));
    return <SourcePreviewLink location={location} className="text-accent underline-offset-4 hover:underline"><code>{value}</code></SourcePreviewLink>;
  }
  if (reference.kind === "url") {
    return <a href={reference.href} target="_blank" rel="noreferrer"><code>{value}</code></a>;
  }
  if (reference.href?.startsWith("#")) {
    return <a href={reference.href} className="text-accent underline-offset-4 hover:underline"><code>{value}</code></a>;
  }
  return <Link to={reference.href!} className="text-accent underline-offset-4 hover:underline"><code>{value}</code></Link>;
}

/** Inline-code references for source strings that are not Markdown blocks. */
export function SpecReferenceText({ children, context }: { children: string; context: SpecReferenceContext }) {
  const parts: ReactNode[] = [];
  let at = 0;
  for (const match of children.matchAll(/`([^`\n]+)`/g)) {
    const start = match.index ?? 0;
    if (start > at) parts.push(children.slice(at, start));
    parts.push(<SpecReference key={`${start}:${match[1]}`} value={match[1]!} context={context} />);
    at = start + match[0].length;
  }
  if (at < children.length) parts.push(children.slice(at));
  return <>{parts}</>;
}
