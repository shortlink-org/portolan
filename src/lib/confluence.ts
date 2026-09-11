// The optional hand-off from a catalogued service or context to the wiki
// where its team writes.
//
// The catalog carries no page ids, so the link is a search by name: the one
// address Confluence answers for any installation. A site URL searches the
// whole site; a URL that names a space narrows the search to it. Cloud and
// Server answer at different paths, told apart by the `/wiki` prefix Cloud
// always has.

import { createIntegrationStore, normalizeIntegrationUrl } from "./integration-url";

export const CONFLUENCE_KEY = "portolan.integrations.confluence";

/** The search page for `name`, on the site or in the space the URL names. */
export function confluenceSearchUrl(
  configured: string,
  name: string,
): string | null {
  const normalized = normalizeIntegrationUrl(configured);
  if (!normalized) return null;
  const url = new URL(normalized);
  const path = url.pathname;
  const space = path.match(/\/(?:spaces|display)\/([^/]+)/)?.[1];
  const cloud = path.match(/^(.*\/wiki)(?:\/.*)?$/)?.[1];
  const params = new URLSearchParams();
  if (cloud !== undefined) {
    url.pathname = `${cloud}/search`;
    params.set("text", name);
    if (space) params.set("spaces", space);
  } else {
    const base = path.replace(/\/(?:spaces|display)\/.*$/, "").replace(/\/$/, "");
    url.pathname = `${base}/dosearchsite.action`;
    params.set("queryString", name);
    if (space) params.set("where", space);
  }
  url.search = params.toString();
  url.hash = "";
  return url.toString();
}

export const useConfluence = createIntegrationStore(CONFLUENCE_KEY);
