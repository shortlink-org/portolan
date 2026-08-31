// The mark.
//
// A portolan chart is drawn around wind roses: a circle with the rhumb lines
// radiating out of it, one long point for each cardinal direction and a shorter
// one between. That is the whole logo - no gradient, no second colour, nothing
// that stops being a logo at 16px.
//
// The star is filled and the ring is stroked, which is the only reason the
// points still read as points at favicon size: eight hairlines crossing inside
// a 16px box turn into a grey smudge, eight solid wedges do not.

import type { SVGProps } from "react";

/** The 8-point rose, tips crossing a ring, drawn on the same 24 grid as the icons. */
export const ROSE_STAR =
  "M 12 1.4 L 12.96 9.69 L 16.38 7.62 L 14.31 11.04 L 22.6 12 L 14.31 12.96 L 16.38 16.38 L 12.96 14.31 L 12 22.6 L 11.04 14.31 L 7.62 16.38 L 9.69 12.96 L 1.4 12 L 9.69 11.04 L 7.62 7.62 L 11.04 9.69 Z";

export function CompassRose({
  size = 16,
  ...rest
}: Omit<SVGProps<SVGSVGElement>, "ref"> & { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      {...rest}
    >
      <circle
        cx={12}
        cy={12}
        r={7.1}
        stroke="currentColor"
        strokeWidth={1.4}
        opacity={0.55}
      />
      <path d={ROSE_STAR} fill="currentColor" />
    </svg>
  );
}

/**
 * Mark plus wordmark, for the sidebar header. Lowercase and set in the mono
 * face: the name is an identifier like everything else this app names.
 */
export function Wordmark({ size = 16 }: { size?: number }) {
  return (
    <span className="flex items-center gap-2 text-ink">
      <CompassRose size={size} className="shrink-0" />
      <span
        className="text-sm font-semibold lowercase"
        style={{ letterSpacing: "-0.01em" }}
      >
        portolan
      </span>
    </span>
  );
}
