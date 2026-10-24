import type { C4Level } from "./levels";

/** A shared link may ask only for a level this page actually offers. */
export function diagramLevel(
  params: URLSearchParams,
  available: readonly C4Level[],
  fallback: C4Level,
): C4Level {
  const value = Number(params.get("level"));
  return available.includes(value as C4Level) ? value as C4Level : fallback;
}

/** Change the diagram scope without dropping tabs, selections or future filters. */
export function withDiagramLevel(
  params: URLSearchParams,
  level: C4Level,
): URLSearchParams {
  const next = new URLSearchParams(params);
  next.set("level", String(level));
  return next;
}
