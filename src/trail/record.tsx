// What counts as a visit.
//
// Not every render, and not every URL the router passes through. A reader
// holding the back button, or stepping through a flow with the arrow keys,
// crosses a dozen states in a second; a journal of seven that recorded all of
// them would be full of places nobody stopped at. So a page has to be stood on
// before it is written down.

import { useEffect } from "react";
import { useLocation } from "react-router";
import { useSelection } from "../selection/store";
import { visitFor } from "./model";
import { useTrailStore } from "./store";

/** Long enough to skip a page passed through, short enough to be there on
 *  arrival — the trail is read after a move, not during one. */
export const VISIT_SETTLE_MS = 400;

export function TrailRecorder() {
  const { pathname } = useLocation();
  const selection = useSelection();
  const record = useTrailStore((s) => s.record);

  useEffect(() => {
    const visit = visitFor(pathname, selection);
    if (!visit) return;
    const timer = setTimeout(() => record(visit), VISIT_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [pathname, selection, record]);

  return null;
}
