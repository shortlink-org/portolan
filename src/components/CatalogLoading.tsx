import type { CSSProperties } from "react";
import { ROSE_STAR } from "./logo";

// The catalog chunk is heavy; while it loads, the mark behaves like the thing
// it is drawn from. The rhumb lines draw out of the rose the way they fan out
// of one on a portolan chart, and the rose swings and settles like a needle
// finding north - then swings again, until the catalog arrives.
//
// The whole screen fades in late, so a warm cache never flashes it.

const RHUMBS = Array.from({ length: 16 }, (_, i) => (i * 360) / 16);

export function CatalogLoading() {
  return (
    <div
      className="catalog-loading flex h-full flex-col items-center justify-center gap-5 bg-canvas text-muted"
      role="status"
    >
      <svg
        width={168}
        height={168}
        viewBox="-84 -84 168 168"
        fill="none"
        aria-hidden
        className="text-ink"
      >
        <g stroke="currentColor" strokeWidth={0.6}>
          {RHUMBS.map((angle, i) => (
            <line
              key={angle}
              className="catalog-loading-rhumb"
              x1={0}
              y1={-26}
              x2={0}
              y2={-82}
              pathLength={1}
              transform={`rotate(${angle})`}
              opacity={i % 2 ? 0.12 : 0.24}
              style={{ "--i": i } as CSSProperties}
            />
          ))}
        </g>
        <g className="catalog-loading-rose">
          <g transform="translate(-24 -24) scale(2)">
            <circle
              cx={12}
              cy={12}
              r={7.1}
              stroke="currentColor"
              strokeWidth={1.1}
              opacity={0.55}
            />
            <path d={ROSE_STAR} fill="currentColor" />
          </g>
        </g>
      </svg>
      <span className="mono text-xs">loading the catalog…</span>
    </div>
  );
}
