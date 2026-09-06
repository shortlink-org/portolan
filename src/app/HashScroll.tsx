// Anchors, made to work.
//
// Every count in this app is a link to the section that holds what it counted,
// and about half of those links cross a route. The browser only scrolls to a
// fragment on a full page load; a client-side navigation to `/c/shop#ctx-events`
// lands at the top of a page whose sections have not been laid out yet. So the
// scroll is done here, after the route has painted.
//
// `#sel=` hashes belong to the selection and are not sections; they are left
// alone.

import { useEffect } from "react";
import { useLocation } from "react-router";

const SEL = "#sel=";

export function HashScroll() {
  const { pathname, hash } = useLocation();

  useEffect(() => {
    if (!hash || hash.startsWith(SEL)) return;
    const id = decodeURIComponent(hash.slice(1));

    // The target is not there yet: the route commits, the browser lays it
    // out, and when a page is leaving the next one is not even mounted until
    // the exit has run. So: a frame at a time until the element exists, then
    // one more so it has a position, and give up after half a second.
    const deadline = performance.now() + 500;
    let frame = 0;
    const look = () => {
      const target = document.getElementById(id);
      if (target) {
        frame = requestAnimationFrame(() =>
          target.scrollIntoView({ block: "start", behavior: "smooth" }),
        );
        return;
      }
      if (performance.now() < deadline) frame = requestAnimationFrame(look);
    };
    frame = requestAnimationFrame(look);
    return () => cancelAnimationFrame(frame);
  }, [pathname, hash]);

  return null;
}
