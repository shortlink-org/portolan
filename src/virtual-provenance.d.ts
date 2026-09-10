// The stamp of every catalog source, as the checkout's history says: served
// by `scripts/provenance.mjs` at build time (portolan.0010). Keyed by the
// path `src/data.ts` gives a source. A staged site imports its sources under
// flattened names; `source` is then the path the file has in the workspace.
declare module "virtual:portolan-provenance" {
  const provenance: Record<
    string,
    { commit: string; generatedAt: string; source?: string }
  >;
  export default provenance;
}
