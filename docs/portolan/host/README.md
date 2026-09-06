# Host

*Generated from the portolan catalog · commit `9 sources` · at 2026-09-05T13:47:23+07:00. Do not edit by hand.*

- **Id:** `portolan.host`
- **Group:** [Portolan](../README.md)
- **Repo:** [`github.com/shortlink-org/portolan`](https://github.com/shortlink-org/portolan)
- **Path:** [`scripts/`](https://github.com/shortlink-org/portolan/tree/main/scripts)
- **Kind:** cli
- **Technologies:** Node.js
- **Owners:** `@shortlink-org/platform`

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

## Commands

| Run | Body | Source |
| --- | --- | --- |
| `npm run dev` | `vite` | [`package.json:7`](https://github.com/shortlink-org/portolan/blob/main/scripts/package.json#L7) |
| `npm run build` | `npm run likec4:gen && tsc --noEmit && vite build && node scripts/site-docs.mjs` | [`package.json:8`](https://github.com/shortlink-org/portolan/blob/main/scripts/package.json#L8) |
| `npm run preview` | `vite preview` | [`package.json:9`](https://github.com/shortlink-org/portolan/blob/main/scripts/package.json#L9) |
| `npm test` | `vitest run` | [`package.json:10`](https://github.com/shortlink-org/portolan/blob/main/scripts/package.json#L10) |
| `npm run test:go` | `go test ./...` | [`package.json:11`](https://github.com/shortlink-org/portolan/blob/main/scripts/package.json#L11) |
| `npm run test:watch` | `vitest` | [`package.json:12`](https://github.com/shortlink-org/portolan/blob/main/scripts/package.json#L12) |
| `npm run typecheck` | `tsc --noEmit && tsc -p plugins/extract-ts` | [`package.json:13`](https://github.com/shortlink-org/portolan/blob/main/scripts/package.json#L13) |
| `npm run likec4:gen` | `node scripts/gen-likec4.mjs && likec4 gen react likec4 -o src/likec4/generated.jsx` | [`package.json:14`](https://github.com/shortlink-org/portolan/blob/main/scripts/package.json#L14) |
| `npm run likec4:validate` | `likec4 validate likec4` | [`package.json:15`](https://github.com/shortlink-org/portolan/blob/main/scripts/package.json#L15) |
| `npm run plugins:build` | `GOOS=wasip1 GOARCH=wasm go build -o plugins/gen-markdown.wasm ./plugins/gen-markdown && GOOS=wasip1 GOARCH=wasm go build -o plugins/gen-mermaid.wasm ./plugins/gen-mermaid && GOOS=wasip1 GOARCH=wasm go build -o plugins/gen-backstage.wasm ./plugins/gen-backstage && javac --release 21 -d plugins/extract-java/build plugins/extract-java/src/org/portolan/extract/*.java` | [`package.json:17`](https://github.com/shortlink-org/portolan/blob/main/scripts/package.json#L17) |
| `npm run schema` | `npm run plugins:build && node scripts/schema.mjs` | [`package.json:18`](https://github.com/shortlink-org/portolan/blob/main/scripts/package.json#L18) |
| `npm run schema:check` | `npm run plugins:build && node scripts/schema.mjs --check` | [`package.json:19`](https://github.com/shortlink-org/portolan/blob/main/scripts/package.json#L19) |
| `npm run gen` | `npm run plugins:build && node scripts/gen.mjs` | [`package.json:20`](https://github.com/shortlink-org/portolan/blob/main/scripts/package.json#L20) |
| `npm run gen:check` | `npm run plugins:build && node scripts/gen.mjs --check` | [`package.json:21`](https://github.com/shortlink-org/portolan/blob/main/scripts/package.json#L21) |
| `npm run diff` | `node scripts/diff.mjs` | [`package.json:22`](https://github.com/shortlink-org/portolan/blob/main/scripts/package.json#L22) |
