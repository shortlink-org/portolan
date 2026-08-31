// GitHub's alert syntax: a blockquote whose first line is a bare `[!NOTE]`
// marker. It turns up in any README written on GitHub, so Portolan renders the
// five kinds GitHub knows and leaves everything else a plain quotation - the
// same rule GitHub itself applies to `[!HINT]`.

export const ADMONITION_KINDS = [
  "note",
  "tip",
  "important",
  "warning",
  "caution",
] as const;

export type AdmonitionKind = (typeof ADMONITION_KINDS)[number];

export const ADMONITION_LABEL: Record<AdmonitionKind, string> = {
  note: "Note",
  tip: "Tip",
  important: "Important",
  warning: "Warning",
  caution: "Caution",
};

/**
 * The marker owns its whole line: `[!NOTE] see below` is prose that happens to
 * start with brackets, not an alert. Matching is case-insensitive, as it is in
 * cmark-gfm, but the label always comes back canonical.
 */
const MARKER = /^\[!([a-z]+)\][^\S\n]*(?:\r?\n|$)/i;

function isKind(word: string): word is AdmonitionKind {
  return (ADMONITION_KINDS as readonly string[]).includes(word);
}

/**
 * Reads the marker off the first text of a blockquote. `rest` is what is left
 * of that text once the marker line is gone - usually the alert's first
 * sentence, empty when the marker stands alone.
 */
export function parseAdmonition(
  text: string,
): { kind: AdmonitionKind; rest: string } | null {
  const match = MARKER.exec(text);
  if (!match) return null;
  const kind = match[1]?.toLowerCase() ?? "";
  if (!isKind(kind)) return null;
  return { kind, rest: text.slice(match[0].length) };
}
