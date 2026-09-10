export interface DocsManifest {
  generate?: { plugin: string; catalog?: string; out: string }[];
}

export interface CatalogDocs {
  pages: string;
  index: string;
  full: string;
}

/** Match site-docs.mjs: the first markdown output is mounted at docs/.
 * Other catalogs are available when generated inside that output directory.
 */
export function catalogDocs(
  manifest: DocsManifest,
  profileId: string,
  base: string,
): CatalogDocs | null {
  const steps = manifest.generate?.filter((step) => step.plugin === "markdown") ?? [];
  const root = steps[0];
  const selected = steps.find((step) => step.catalog === profileId)
    ?? steps.find((step) => !step.catalog);
  if (!root || !selected) return null;

  const directory = (out: string) => new URL(`${out.replace(/\/$/, "")}/`, "https://workspace.invalid/").pathname;
  const rootPath = directory(root.out);
  const selectedPath = directory(selected.out);
  if (!selectedPath.startsWith(rootPath)) return null;

  const prefix = base.endsWith("/") ? base : `${base}/`;
  const suffix = selectedPath.slice(rootPath.length);
  const pages = `${prefix}docs/${suffix}`;
  const indexRoot = suffix ? pages : prefix;
  return { pages, index: `${indexRoot}llms.txt`, full: `${indexRoot}llms-full.txt` };
}
