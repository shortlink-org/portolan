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

    // Two frames: the first is the route's own commit, the second is after the
    // browser has laid it out, which is the earliest the target has a position.
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        document
          .getElementById(id)
          ?.scrollIntoView({ block: "start", behavior: "smooth" });
      });
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [pathname, hash]);

  return null;
}
