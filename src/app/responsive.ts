// One breakpoint, named once.
//
// 1100px is not a phone. It is the width a 13" laptop has left after the reader
// has put something else beside portolan, and below it the three-pane shell
// stops being three panes: the tree becomes a drawer and the detail rail
// becomes a sheet. That is graceful degradation of a desktop tool, not a mobile
// design, and nothing below this line pretends otherwise.

import { useEffect, useState } from "react";

export const NARROW_QUERY = "(max-width: 1099px)";

function match(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(NARROW_QUERY).matches;
}

/** True while the viewport is too narrow to hold the panes side by side. */
export function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(match);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia(NARROW_QUERY);
    const onChange = () => setNarrow(mq.matches);
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
  }, []);
  return narrow;
}
