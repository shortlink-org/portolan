// The hand-off from a page to where its team writes: a Confluence search by
// name, and the Notion workspace. Nothing until the reader has configured
// either under Settings → Integrations; the values live in this browser.

import { ExternalLink } from "lucide-react";
import { confluenceSearchUrl, useConfluence } from "../lib/confluence";
import { useNotion } from "../lib/notion";

const LINK =
  "inline-flex items-center gap-1 whitespace-nowrap rounded-control text-accent hover:underline";

export function DocsLinksContent({
  name,
  confluence,
  notion,
}: {
  /** What to search for: the service's or context's name. */
  name: string;
  confluence: string;
  notion: string;
}) {
  const search = confluenceSearchUrl(confluence, name);
  if (!search && !notion) return null;
  return (
    <>
      {search ? (
        <a
          href={search}
          target="_blank"
          rel="noreferrer"
          className={LINK}
          title={`Search Confluence for ${name}`}
        >
          view in Confluence <ExternalLink size={12} aria-hidden />
        </a>
      ) : null}
      {notion ? (
        <a
          href={notion}
          target="_blank"
          rel="noreferrer"
          className={LINK}
          title="Open the Notion workspace where the documentation lives"
        >
          open Notion <ExternalLink size={12} aria-hidden />
        </a>
      ) : null}
    </>
  );
}

export function DocsLinks({ name }: { name: string }) {
  const confluence = useConfluence((state) => state.url);
  const notion = useNotion((state) => state.url);
  return <DocsLinksContent name={name} confluence={confluence} notion={notion} />;
}
