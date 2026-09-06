// Ids in an answer become links to their pages.
//
// The model is told to name things by their catalog ids, and the catalog
// knows the page of every id, so the join is a string replacement - done on
// the markdown before it is rendered, which keeps Markdown.tsx as it is.
// Fenced code is left alone; a bare id or one in backticks is linked; text
// already inside a link is not linked twice.

export type LinkTable = ReadonlyMap<string, string>;

function escape(id: string): string {
  return id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Skips fenced blocks and existing links; the rest is prose. */
const KEEP = /(```[\s\S]*?```|\[[^\]\n]*\]\([^)\n]*\))/g;

export function linkify(markdown: string, links: LinkTable): string {
  if (links.size === 0 || markdown === "") return markdown;
  // Longest first, so `shop.oms.order` is not eaten by `shop.oms`.
  const ids = [...links.keys()].sort((a, b) => b.length - a.length);
  const alternatives = ids.map(escape).join("|");
  // Not preceded by a word character, a dot, a dash or a slash (part of a
  // longer id or a path), not followed by one either. A trailing dot is
  // punctuation and is left outside the match.
  const bare = new RegExp(
    `(?<![\\w.\\-/])(${alternatives})(?![\\w\\-/]|\\.[\\w])`,
    "g",
  );
  const inCode = new RegExp(`\`(${alternatives})\``, "g");

  return markdown
    .split(KEEP)
    .map((piece, index) => {
      if (index % 2 === 1) return piece; // a kept block
      return piece
        .replace(inCode, (_, id: string) => `[\`${id}\`](${links.get(id)})`)
        .replace(bare, (match, id: string, offset: number, whole: string) => {
          // Inside the link text just written by the step above.
          if (whole.slice(0, offset).endsWith("[`")) return match;
          return `[${id}](${links.get(id)})`;
        });
    })
    .join("");
}
