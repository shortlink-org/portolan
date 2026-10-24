function displayPlain(value: string): string {
  return value
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function plain(value: string): string {
  return displayPlain(value).toLocaleLowerCase();
}

function withoutMatchingHeading(markdown: string, title: string): string {
  const rest = markdown.trimStart();
  const heading = /^(#{1,6})\s+(.+?)\s*#*\s*(?:\n+|$)/.exec(rest);
  return heading && plain(heading[2] ?? "") === plain(title)
    ? rest.slice(heading[0].length).trimStart()
    : rest;
}

function leadingParagraph(markdown: string): RegExpExecArray | null {
  if (/^\s*(?:#|[-*+]\s|\d+\.\s|>|```|~~~)/.test(markdown)) return null;
  return /^([^\n]+(?:\n(?!\s*(?:$|#|[-*+]\s|\d+\.\s|>|```|~~~)).+)*)\n*/.exec(markdown);
}

/** The first prose sentence under an entity's matching README title. */
export function leadingMarkdownSummary(markdown: string, title: string): string | null {
  const paragraph = leadingParagraph(withoutMatchingHeading(markdown, title));
  return paragraph ? displayPlain(paragraph[1] ?? "") || null : null;
}

/**
 * Removes identity already owned by an entity page's header from the start of
 * an authored README. Only exact textual matches are removed: a different
 * heading or opening paragraph is evidence in its own right and stays put.
 */
export function stripLeadingMarkdownIdentity(
  markdown: string,
  title: string,
  summary?: string,
): string {
  let rest = withoutMatchingHeading(markdown, title);

  if (!summary) return rest;
  const paragraph = leadingParagraph(rest);
  if (paragraph && plain(paragraph[1] ?? "") === plain(summary)) {
    rest = rest.slice(paragraph[0].length).trimStart();
  }
  return rest;
}
