// What the flow page remembers, per flow.
//
// Two settings, and both are per-flow rather than global on purpose. Which
// variant reads better depends on how long the sequence is, and whether the
// summary is worth two lines or ten depends on what the summary says — neither
// is a statement about how this reader likes flow pages in general, so neither
// belongs in a global preference.

import { useCallback, useState } from "react";

export type Variant = "diagram" | "sequence";

/**
 * Above this many steps a sequence rendered at a readable zoom is longer than
 * any screen, and the diagram — which folds the same steps onto the lanes that
 * repeat — is the one that fits. Below it the sequence is strictly better,
 * because the order is the whole point of a flow and only the sequence draws
 * order as position.
 */
export const SEQUENCE_MAX_STEPS = 12;

export function defaultVariant(stepCount: number): Variant {
  return stepCount > SEQUENCE_MAX_STEPS ? "diagram" : "sequence";
}

export interface FlowPrefs {
  variant: Variant;
  /** The summary is shown in full rather than clamped to two lines. */
  expanded: boolean;
}

const key = (slug: string): string => `portolan.flow.${slug}`;

/**
 * localStorage, but a private-mode failure is not worth a crash: a preference
 * that cannot be remembered is a preference that starts at its default.
 */
export function readPrefs(slug: string, fallback: Variant): FlowPrefs {
  const defaults: FlowPrefs = { variant: fallback, expanded: false };
  try {
    const raw = localStorage.getItem(key(slug));
    if (!raw) return defaults;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return defaults;
    const value = parsed as Partial<FlowPrefs>;
    return {
      variant:
        value.variant === "diagram" || value.variant === "sequence"
          ? value.variant
          : fallback,
      expanded: value.expanded === true,
    };
  } catch {
    return defaults;
  }
}

export function writePrefs(slug: string, prefs: FlowPrefs): void {
  try {
    localStorage.setItem(key(slug), JSON.stringify(prefs));
  } catch {
    /* private mode: this session still switches, it just does not persist */
  }
}

/**
 * The remembered settings for one flow, and one setter for changing part of
 * them. Re-reads when the slug changes, so walking from flow to flow picks up
 * each one's own choice rather than carrying the last one along.
 */
export function useFlowPrefs(
  slug: string,
  stepCount: number,
): [FlowPrefs, (patch: Partial<FlowPrefs>) => void] {
  const fallback = defaultVariant(stepCount);
  const [state, setState] = useState<{ slug: string; prefs: FlowPrefs }>(() => ({
    slug,
    prefs: readPrefs(slug, fallback),
  }));

  // Derived during render rather than in an effect: an effect would draw one
  // frame of the previous flow's settings before correcting itself, and on
  // this page that frame is a whole re-layout of the canvas.
  const prefs =
    state.slug === slug ? state.prefs : readPrefs(slug, defaultVariant(stepCount));
  if (state.slug !== slug) setState({ slug, prefs });

  const update = useCallback(
    (patch: Partial<FlowPrefs>) => {
      setState((current) => {
        const base =
          current.slug === slug
            ? current.prefs
            : readPrefs(slug, defaultVariant(stepCount));
        const next = { ...base, ...patch };
        writePrefs(slug, next);
        return { slug, prefs: next };
      });
    },
    [slug, stepCount],
  );

  return [prefs, update];
}
