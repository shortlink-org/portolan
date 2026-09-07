// The tab's name.
//
// Every page used to be called "portolan": twelve tabs open on twelve pages
// read as twelve copies of one, history was a list of the same word, and a
// screen reader announced nothing on a route change. The page that knows its
// own name says it here, and the app's name follows so the tab is still
// findable among a reader's others.

import { useEffect } from "react";

const APP = "portolan";

/** "Orders · portolan", or the bare app name when a page has no name yet. */
export function pageTitle(name: string | null | undefined): string {
  const trimmed = name?.trim();
  return trimmed ? `${trimmed} · ${APP}` : APP;
}

/**
 * Sets the document title while the caller is mounted, and hands it back on
 * the way out so a page that sets none is not called by the last one that did.
 */
export function useDocumentTitle(name: string | null | undefined): void {
  useEffect(() => {
    document.title = pageTitle(name);
    return () => {
      document.title = APP;
    };
  }, [name]);
}
