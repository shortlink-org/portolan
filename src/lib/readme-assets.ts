/** Turn a README-relative file into the public asset staged beside the app. */
export function readmeAssetHref(
  root: string,
  target: string,
  base = "/",
): string | null {
  const value = target.trim();
  if (
    !value ||
    value.startsWith("#") ||
    value.startsWith("/") ||
    /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)
  ) return null;

  const suffixAt = value.search(/[?#]/);
  const pathname = suffixAt < 0 ? value : value.slice(0, suffixAt);
  const suffix = suffixAt < 0 ? "" : value.slice(suffixAt);
  const rootParts = root.replaceAll("\\", "/").split("/").filter(Boolean);
  const parts = [...rootParts];
  for (const part of pathname.replaceAll("\\", "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length === rootParts.length) return null;
      parts.pop();
      continue;
    }
    try { parts.push(decodeURIComponent(part)); }
    catch { return null; }
  }
  if (parts.length === rootParts.length) return null;

  const prefix = base.endsWith("/") ? base : `${base}/`;
  return `${prefix}portolan-assets/${parts.map((part) => encodeURIComponent(part)).join("/")}${suffix}`;
}
