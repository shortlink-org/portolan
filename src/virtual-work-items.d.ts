// Task links read from the checkout's history at build time by
// `scripts/work-items-history.mjs` (portolan.0020): one fragment per
// work-items verifier, with the path the manifest's catalogs name it by and
// the catalogs that include it (null when the manifest declares none).
declare module "virtual:portolan-work-items" {
  const sources: {
    path: string;
    catalogs: string[] | null;
    fragment: import("./merge").SourceCatalog;
  }[];
  export default sources;
}
