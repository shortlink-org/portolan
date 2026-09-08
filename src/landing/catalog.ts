// The landing's link into the catalog it demonstrates.
//
// The landing shows the example estate (data.ts picks that profile for the
// `/landing` route), and every "open this in the catalog" it offers has to
// land on the same estate after a reload as it does on a click. So the profile
// is spelled on the URL, the way the catalog app itself keeps it there.

import { useEffect } from "react";
import { activeCatalogProfile } from "../data";
import { useSelectionStore } from "../selection/store";

export function catalogTo(pathname: string): { pathname: string; search: string } {
  return { pathname, search: `?catalog=${activeCatalogProfile.id}` };
}

/**
 * The canvases on the landing write to the app's one selection store, the
 * same as they do on their own pages. A demo that is unmounted - a tab
 * switched, the page left - must not leave its selection behind for the
 * catalog's detail panel to open on.
 */
export function useSelectionCleared(): void {
  const clear = useSelectionStore((s) => s.clear);
  useEffect(() => () => clear("diagram"), [clear]);
}
