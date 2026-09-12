# Host

*Generated from the portolan catalog. Do not edit by hand.*

- **Id:** `portolan.host`
- **Group:** [Portolan](../README.md)
- **Repo:** [`github.com/shortlink-org/portolan`](https://github.com/shortlink-org/portolan)
- **Path:** [`scripts/`](https://github.com/shortlink-org/portolan/tree/main/scripts)
- **Kind:** cli
- **Technologies:** Node.js

The side of portolan that runs. `npm run gen` reads the manifest, runs every
plugin it names, writes what comes back, merges the sources into one estate
and validates the union. Nothing here draws anything.

## What it does

- Refuses a `portolan.json` that does not match `schema/portolan.schema.json`,
  the schema `npm run schema` composes out of what every declared plugin says
  it can be told.
- Runs three phases in order, extract, verify, generate, and hands each
  plugin one JSON message: the input root and output directory for an
  extractor, the merged catalog for a verifier or a generator, the step's
  options unread. The output path lets a fragment point at a companion file
  returned in the same response without letting the plugin write it itself.
- Writes no provenance into a fragment. When a source last changed, and in
  which commit, is read from the history of the checkout wherever the catalog
  is read - here, by the LikeC4 generator, by the architecture diff and by
  the site as Vite builds it - so a fragment is content and nothing else, and
  regenerating from the same sources changes no byte (portolan.0010).
- Writes the files a plugin named, refuses a name that climbs out of the
  step's output directory, keeps a listing per step of what it wrote, and
  deletes what stopped being generated (portolan.0001).
- Merges every source the manifest's globs find and validates the union with
  the code the site runs: `src/merge.ts`, `src/catalog.ts`, `src/enrich.ts`.
- In `--check` mode writes nothing and fails on the first file that differs
  from disk, saying where the file first differs and what changed among the
  step's inputs since its output was last committed - the history is the
  record of the last generation, so nothing else has to be. Either way it
  leaves `.portolan/build-report.json` for the Settings page.

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
  `diff.mjs`, what a branch changes about the architecture; `forge-comment.mjs`,
  that report put on the pull request as one comment kept current;
  `forge-release.mjs`, the same report as one section of a release's notes;
  `forge.mjs`, what those two share - which forge the CI is, and how to talk
  to it; `history.mjs`, what the checkout's history says about every file,
  for a plugin that asks and for the provenance of every source;
  `provenance.mjs`, that provenance handed to the site as one virtual module;
  `output-diff.mjs`, where a generated file first differs from what the
  generator produces; `site-docs.mjs`, generated documentation put into the
  built site; `local-api.mjs`, what the dev server answers the site with.

## Commands

| Run | Body | Source |
| --- | --- | --- |
| `npm run dev` | `node cli/portolan.mjs dev` | [`package.json:60`](https://github.com/shortlink-org/portolan/blob/main/scripts/package.json#L60) |
| `npm run build` | `node cli/portolan.mjs build` | [`package.json:61`](https://github.com/shortlink-org/portolan/blob/main/scripts/package.json#L61) |
| `npm run preview` | `vite preview` | [`package.json:62`](https://github.com/shortlink-org/portolan/blob/main/scripts/package.json#L62) |
| `npm test` | `vitest run` | [`package.json:63`](https://github.com/shortlink-org/portolan/blob/main/scripts/package.json#L63) |
| `npm run test:go` | `GOFLAGS=-mod=mod go test ./...` | [`package.json:64`](https://github.com/shortlink-org/portolan/blob/main/scripts/package.json#L64) |
| `npm run test:package` | `node scripts/package-smoke.mjs` | [`package.json:66`](https://github.com/shortlink-org/portolan/blob/main/scripts/package.json#L66) |
| `npm run test:watch` | `vitest` | [`package.json:67`](https://github.com/shortlink-org/portolan/blob/main/scripts/package.json#L67) |
| `npm run typecheck` | `tsc --noEmit && tsc -p plugins/extract-ts` | [`package.json:68`](https://github.com/shortlink-org/portolan/blob/main/scripts/package.json#L68) |
| `npm run likec4:gen` | `node scripts/gen-likec4.mjs && likec4 gen react likec4 -o src/likec4/generated.jsx --no-use-dot` | [`package.json:69`](https://github.com/shortlink-org/portolan/blob/main/scripts/package.json#L69) |
| `npm run likec4:validate` | `likec4 validate likec4` | [`package.json:70`](https://github.com/shortlink-org/portolan/blob/main/scripts/package.json#L70) |
| `npm run plugins:build` | `GOFLAGS=-mod=mod GOOS=wasip1 GOARCH=wasm go build -trimpath -ldflags="-s -w" -o plugins/portolan-go.wasm ./plugins/cmd/portolan-go && javac --release 21 -d plugins/extract-java/build plugins/extract-java/src/org/portolan/extract/*.java && dotnet build plugins/extract-csharp-ddd -c Release --nologo -v q` | [`package.json:72`](https://github.com/shortlink-org/portolan/blob/main/scripts/package.json#L72) |
| `npm run schema` | `npm run plugins:build && node scripts/schema.mjs` | [`package.json:73`](https://github.com/shortlink-org/portolan/blob/main/scripts/package.json#L73) |
| `npm run schema:check` | `npm run plugins:build && node scripts/schema.mjs --check` | [`package.json:74`](https://github.com/shortlink-org/portolan/blob/main/scripts/package.json#L74) |
| `npm run gen` | `npm run plugins:build && node scripts/gen.mjs` | [`package.json:75`](https://github.com/shortlink-org/portolan/blob/main/scripts/package.json#L75) |
| `npm run gen:check` | `npm run plugins:build && node scripts/gen.mjs --check` | [`package.json:76`](https://github.com/shortlink-org/portolan/blob/main/scripts/package.json#L76) |
| `npm run diff` | `node scripts/diff.mjs` | [`package.json:77`](https://github.com/shortlink-org/portolan/blob/main/scripts/package.json#L77) |
| `npm run prepack` | `npm run plugins:build` | [`package.json:78`](https://github.com/shortlink-org/portolan/blob/main/scripts/package.json#L78) |
