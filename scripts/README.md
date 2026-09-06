# Host

The side of portolan that runs. `npm run gen` reads the manifest, runs every
plugin it names, stamps and writes what comes back, merges the sources into
one estate and validates the union. Nothing here draws anything.

## What it does

- Refuses a `portolan.json` that does not match `schema/portolan.schema.json`,
  the schema `npm run schema` composes out of what every declared plugin says
  it can be told.
- Runs three phases in order, extract, verify, generate, and hands each
  plugin one JSON message: the input root and its stamp for an extractor, the
  merged catalog for a verifier or a generator, the step's options unread.
- Stamps a fragment from the last commit that touched its input, never from a
  clock, so a committed fragment changes exactly when its subject does
  (portolan.0002).
- Writes the files a plugin named, refuses a name that climbs out of the
  step's output directory, keeps a listing per step of what it wrote, and
  deletes what stopped being generated (portolan.0001).
- Merges every source the manifest's globs find and validates the union with
  the code the site runs: `src/merge.ts`, `src/catalog.ts`, `src/enrich.ts`.
- In `--check` mode writes nothing and fails on the first file that differs
  from disk. Either way it leaves `.portolan/build-report.json` for the
  Settings page.

## What it does not do

- Know what any plugin can be told: options pass through, and the schema is
  the plugins' answer, not the host's.
- Read a plugin's stdout for anything but the one message, or its stderr for
  anything but notes; a warning is kept beside the step in the build report.
- Draw the C4 model: `gen-likec4.mjs` writes `likec4/` from the same merged
  catalog, and the site draws.

## Files

- `gen.mjs`, the three phases; `plugin-host.mjs` and
  `plugin-wasm-worker.mjs`, one plugin run as a process or a wasm module;
  `manifest.mjs`, the manifest read and checked; `catalog-sources.mjs`, the
  merge; `output-path.mjs`, the one refusal of an unsafe name;
  `build-report.mjs`, what the Settings page reads.
- `schema.mjs`, the manifest schema composed; `gen-likec4.mjs`, the C4 model;
  `diff.mjs`, what a branch changes about the architecture; `vendor-lock.mjs`,
  the commit a fetched copy is of; `site-docs.mjs`, generated documentation
  put into the built site; `local-api.mjs`, what the dev server answers the
  site with.
