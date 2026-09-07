import { FileText } from "lucide-react";
import { activeCatalogProfile } from "../data";

// The site as a language model reads it. The build (scripts/site-docs.mjs)
// places the generated markdown under docs/ and llms.txt at the root, in the
// shape llmstxt.org asks for, and the same script's Vite plugin answers the
// paths in development. Plain anchors, not router links: these are files
// beside the app, and a full navigation is the point.

const base = import.meta.env.BASE_URL;

const suffix = activeCatalogProfile.id === "portolan" ? "" : `${activeCatalogProfile.id}/`;
const docs = `${base}docs/${suffix}`;
const FILES = [
  { href: suffix ? `${docs}llms.txt` : `${base}llms.txt`, label: "llms.txt", title: "An index of every page, for a model that fetches on demand" },
  { href: suffix ? `${docs}llms-full.txt` : `${base}llms-full.txt`, label: "llms-full.txt", title: "Every page in one file, for a model with a context window" },
  { href: docs, label: "docs/", title: "The generated markdown, page by page" },
  { href: `${base}exports/mermaid/${suffix}`, label: "Mermaid", title: "Standalone sequence diagrams for every architecture flow" },
  ...(activeCatalogProfile.id === "example"
    ? [{ href: `${base}exports/backstage/catalog-info.yaml`, label: "Backstage", title: "Components, systems, APIs and resources for a Backstage catalog" }]
    : []),
];

/** Links to the generated documentation, one line. */
export function MachineDocs({ className = "" }: { className?: string }) {
  return (
    <div className={`mono flex flex-wrap items-center gap-x-3 gap-y-1 text-muted ${className}`}>
      <FileText size={14} aria-hidden />
      <span>for language models:</span>
      {FILES.map((file) => (
        <a
          key={file.label}
          href={file.href}
          title={file.title}
          className="rounded-control text-accent hover:underline"
        >
          {file.label}
        </a>
      ))}
    </div>
  );
}
