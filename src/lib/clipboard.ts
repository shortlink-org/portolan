// Copying, in one place.
//
// Three surfaces put text on the clipboard - an <Ident>, a row's copy button,
// and a section's anchor link - and all three have to survive the same two
// failures: an insecure origin, and a browser that refuses the async API
// without a gesture it recognises. Written once so a copy that works on the
// overview cannot silently fail on a page that reimplemented it.

export async function toClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // The fallback is old but it is the one that still works there.
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(area);
      return ok;
    } catch {
      return false;
    }
  }
}

/**
 * The absolute URL of a fragment on the page the reader is standing on.
 *
 * `pathname` already carries the router's basename, so this is the link a
 * colleague can open - not the in-app path, which is missing `/portolan/` on
 * every deploy that is not at a domain root.
 */
export function anchorUrl(id: string): string {
  if (typeof window === "undefined") return `#${id}`;
  const { origin, pathname, search } = window.location;
  return `${origin}${pathname}${search}#${id}`;
}
