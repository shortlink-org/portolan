// The catalog sources the site reads, served by `scripts/site-sources.mjs`:
// one loader per profile, each answering that profile's sources keyed by the
// path the site imports them under (in a staged site, the flattened name).
declare module "virtual:portolan-sources" {
  const loaders: Record<string, () => Promise<Record<string, unknown>>>;
  export default loaders;
}
