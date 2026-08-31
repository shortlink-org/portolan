// The link back to a heading.
//
// Every section in this app already has an id - the counts in a page header
// link to them, and the TOC walks them - but until now the only way to get one
// out of the app was to read the TOC's href off the status bar. This is the
// other half: a real <a> to the fragment, so the browser's own "copy link
// address" works, and a click that also puts the absolute URL on the clipboard,
// because that is what the reader wanted from the click.
//
// It is hidden until the heading is hovered or something in it takes focus,
// for the same reason RowActions is: a page with nine sections must not also be
// a page with nine little chain icons down the left.

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Link2 } from "lucide-react";
import { anchorUrl, toClipboard } from "../lib/clipboard";

const SHOWN_MS = 1000;

export function AnchorLink({
  id,
  label,
}: {
  /** The id of the element on the page this points at. */
  id: string;
  /** What the link says it points at, for the accessible name. */
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  // No preventDefault: the browser still moves to the fragment and puts it in
  // the address bar, which is half of what "link to this" means. The copy is
  // the other half, and it rides along.
  const onClick = useCallback(() => {
    void toClipboard(anchorUrl(id)).then((ok) => {
      setCopied(ok);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), SHOWN_MS);
    });
  }, [id]);

  const what = label ? `link to ${label}` : "link to this section";

  return (
    <a
      href={`#${id}`}
      onClick={onClick}
      className="anchor-link"
      aria-label={`Copy ${what}`}
      title={copied ? "copied" : `Copy ${what}`}
    >
      {copied ? (
        <Check size={12} aria-hidden />
      ) : (
        <Link2 size={12} aria-hidden />
      )}
    </a>
  );
}
