// The five DDD building blocks, drawn rather than borrowed.
//
// Lucide has no vocabulary for a domain event or a value object, so what it
// lends instead is a metaphor: Zap for an event, Diamond for a value object,
// Square for an entity. Each of those says "roughly this shape" and nothing
// about what the thing IS. These five say what the thing is.
//
// They are drawn on lucide's own grid - 24x24, 1.5px stroke, round caps and
// joins, no fill - so a value object standing next to a lucide chevron in the
// tree reads as one family and not as an imported sticker.
//
// The semantics, one line each:
//
//   event    a fact, announced: a point that already happened, and the pulse
//            leaving it. Every other context hears about it after the fact.
//   vo       a shape with no identity: a diamond holding an equals sign -
//            two equal values ARE the same value.
//   entity   a shape with identity: the same square, and the one dot that
//            says this instance is not that one.
//   command  a directive arriving at the aggregate: an arrow that lands on
//            the boundary and changes what is behind it.
//   query    the same boundary, answering: rows leaving it, changing nothing.

import type { SVGProps } from "react";

export interface DddIconProps extends Omit<SVGProps<SVGSVGElement>, "ref"> {
  size?: number;
}

/**
 * Shared frame. Every attribute lucide sets on its own icons is set here, so
 * the two families size, colour and align identically.
 */
function Icon({ size = 16, children, ...rest }: DddIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      {children}
    </svg>
  );
}

/** A fact that happened, and the pulse that carried it outward. */
export function EventIcon(props: DddIconProps) {
  return (
    <Icon {...props}>
      <circle cx={7} cy={12} r={1.6} />
      <path d="M9.9 8.4a4.6 4.6 0 0 1 0 7.2" />
      <path d="M12.2 5.4a8.4 8.4 0 0 1 0 13.2" />
    </Icon>
  );
}

/** No identity: equal values are the same value. */
export function ValueObjectIcon(props: DddIconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3.5 20.5 12 12 20.5 3.5 12Z" />
      <path d="M9 10.5h6" />
      <path d="M9 13.5h6" />
    </Icon>
  );
}

/** Identity: this one, tracked over time, and not that one. */
export function EntityIcon(props: DddIconProps) {
  return (
    <Icon {...props}>
      <rect x={4} y={4} width={16} height={16} rx={3} />
      <circle cx={12} cy={12} r={1.6} />
    </Icon>
  );
}

/** A directive landing on the aggregate boundary. */
export function CommandIcon(props: DddIconProps) {
  return (
    <Icon {...props}>
      <path d="M19 4.5v15" />
      <path d="M4 12h11" />
      <path d="m11.5 8.5 3.5 3.5-3.5 3.5" />
    </Icon>
  );
}

/** The same boundary, answering. Rows out, nothing changed. */
export function QueryIcon(props: DddIconProps) {
  return (
    <Icon {...props}>
      <path d="M19 4.5v15" />
      <path d="M19 9H7" />
      <path d="m10.5 5.5-3.5 3.5 3.5 3.5" />
      <path d="M19 15h-8" />
      <path d="m14.5 11.5-3.5 3.5 3.5 3.5" />
    </Icon>
  );
}
