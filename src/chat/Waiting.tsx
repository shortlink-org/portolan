// The half minute between a question and its first word.
//
// A free tier answers slowly, and a panel that shows nothing for thirty
// seconds looks broken. So: a small boat on a wave, eight frames in one inline
// SVG stepped along by CSS, and a line saying which part of the wait this is.
// Inline rather than a background image so it is drawn in currentColor and
// follows the theme.

const FRAMES = 8;
const SIZE = 24;

/** One frame: the wave at a phase, the boat lifted with it. */
function Frame({ index }: { index: number }) {
  const phase = (index / FRAMES) * Math.PI * 2;
  const lift = Math.round(Math.sin(phase) * 1.5);
  const shift = (index / FRAMES) * 8;
  // Two wave periods across the frame, slid by the phase.
  const wave = `M${-8 + shift} 19 q2 -2 4 0 t4 0 t4 0 t4 0 t4 0 t4 0 t4 0`;
  return (
    <g transform={`translate(${index * SIZE} 0)`}>
      <g transform={`translate(0 ${lift})`}>
        {/* hull */}
        <path d="M6 15 h12 l-2 3 h-8 z" fill="currentColor" />
        {/* mast and sail */}
        <path d="M12 15 v-9" stroke="currentColor" strokeWidth="1.2" />
        <path d="M12.6 6.5 l5 7 h-5 z" fill="currentColor" opacity="0.75" />
      </g>
      <path
        d={wave}
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        opacity="0.55"
      />
    </g>
  );
}

export function Sprite({ className = "" }: { className?: string }) {
  return (
    <svg
      width={SIZE}
      height={SIZE}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      className={`shrink-0 overflow-hidden ${className}`}
      aria-hidden
    >
      <g
        style={{
          animation: `chat-sprite 1.1s steps(${FRAMES}) infinite`,
        }}
      >
        {Array.from({ length: FRAMES }, (_, index) => (
          <Frame key={index} index={index} />
        ))}
      </g>
    </svg>
  );
}

/** The boat at rest: frame one, for the gutter beside an answer. */
export function Boat({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      className={`shrink-0 ${className}`}
      aria-hidden
    >
      <Frame index={0} />
    </svg>
  );
}

/** The sprite and what it is waiting for. */
export function Waiting({ label }: { label: string }) {
  return (
    <div
      role="status"
      className="mono flex items-center gap-2 py-1 text-muted"
    >
      <Sprite />
      <span className="truncate">{label}</span>
    </div>
  );
}
