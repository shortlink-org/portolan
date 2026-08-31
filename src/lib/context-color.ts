import type { CSSProperties } from "react";
import { catalog } from "../data";

const CTX_SLOTS = 6;

/** Context colour is assigned deterministically by index in catalog order. */
const order: string[] = catalog.contexts.map((c) => c.id);

export function contextVar(contextId: string | null | undefined): string {
  if (!contextId) return "var(--fg-muted)";
  const i = order.indexOf(contextId);
  if (i < 0) return "var(--fg-muted)";
  return `var(--ctx-${i % CTX_SLOTS})`;
}

/**
 * Feeds the `ctx` utility. Setting one custom property beats generating a
 * colour utility per context, and keeps the value out of the class string.
 */
export function ctxStyle(contextId: string | null | undefined): CSSProperties {
  return { "--ctx": contextVar(contextId) } as CSSProperties;
}

export function contextName(contextId: string | null | undefined): string {
  if (!contextId) return "—";
  return catalog.contexts.find((c) => c.id === contextId)?.name ?? contextId;
}
