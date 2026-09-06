// A brand's mark, drawn so it sits in a row with lucide.
//
// simple-icons fills its 24x24 box edge to edge; lucide leaves a 2px margin
// inside its own. Shown at the same pixel size the brand mark would read a
// step heavier than the database glyph beside it, so the viewBox is opened by
// two units on every side and the two families weigh the same.

import type { TechGlyph } from "../lib/tech";

export function TechIcon({
  glyph,
  size = 14,
  className = "",
}: {
  glyph: TechGlyph;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="-2 -2 28 28"
      fill="currentColor"
      aria-hidden
      /* `block` for the same reason KindIcon is: no inline baseline gap, so
         the mark centres on the text beside it. */
      className={`block shrink-0 ${className}`}
    >
      <path d={glyph.path} />
    </svg>
  );
}
