// Two breakpoints, named once.
//
// 1100px is not a phone. It is the width a 13" laptop has left after the reader
// has put something else beside portolan, and below it the three-pane shell
// stops being three panes: the tree becomes a drawer and the detail rail
// becomes a sheet. That is graceful degradation of a desktop tool, not a mobile
// design, and nothing below this line pretends otherwise.
//
// 640px is a phone held upright, and it is a second thing entirely. The shell
// has already degraded by then; what runs out at this width is the top bar's
// own row, which carries a search box, five controls and a build stamp beside
// the breadcrumbs. Wrapping turned that into three rows of chrome above a page
// that had four rows of its own, so below this width the bar keeps one row and
// puts what does not fit behind an icon.

import { useEffect, useState } from "react";

export const NARROW_QUERY = "(max-width: 1099px)";
export const PHONE_QUERY = "(max-width: 639px)";

function match(query: string): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(query).matches;
}

function useMediaQuery(query: string): boolean {
  const [on, setOn] = useState(() => match(query));
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia(query);
    const onChange = () => setOn(mq.matches);
    mq.addEventListener("change", onChange);
    // The resize listener is the belt to matchMedia's braces. Under a viewport
    // that is emulated rather than dragged - devtools, a screenshot harness -
    // the media query updates but its change event never fires, and the shell
    // would sit in the wrong layout until the next reload.
    window.addEventListener("resize", onChange);
    onChange();
    return () => {
      mq.removeEventListener("change", onChange);
      window.removeEventListener("resize", onChange);
    };
  }, [query]);
  return on;
}

/** True while the viewport is too narrow to hold the panes side by side. */
export function useNarrow(): boolean {
  return useMediaQuery(NARROW_QUERY);
}

/** True while the viewport is too narrow to hold the top bar on one row. */
export function usePhone(): boolean {
  return useMediaQuery(PHONE_QUERY);
}
