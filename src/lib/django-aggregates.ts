// The parser itself is django-aggregates.mjs, which the CLI's `init` reads
// from node_modules, where Node strips no types. This name is what the site
// imports, so the .mjs stays the one place it is written.
export { djangoAggregateCandidates, djangoAggregateMessage } from "./django-aggregates.mjs";
export type { DjangoAggregateCandidates } from "./django-aggregates.mjs";
