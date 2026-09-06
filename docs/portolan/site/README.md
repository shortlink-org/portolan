# Site

*Generated from the portolan catalog · commit `10 sources` · at 2026-09-05T03:58:04Z. Do not edit by hand.*

- **Id:** `portolan.site`
- **Group:** [Portolan](../README.md)
- **Repo:** [`github.com/shortlink-org/portolan`](https://github.com/shortlink-org/portolan)
- **Path:** [`src/`](https://github.com/shortlink-org/portolan/tree/main/src)
- **Kind:** webapp
- **Technologies:** TypeScript, React, Vite
- **Owners:** `@shortlink-org/platform`

The browser: a React single-page application that loads every source the
manifest names, merges them, validates the union and renders the estate.
Static end to end; there is no backend and no runtime query.

## What it does

- Decides the shape of a catalog. `catalog.ts` is the contract, with the
  reasoning beside each field; `catalog/` in Go is a mirror of it, held by a
  round-trip test (portolan.0003). The validator lives here too, and runs
  before anything is drawn: a catalog that fails renders the failure.
- Merges sources and derives what they imply. `merge.ts` and `enrich.ts` are
  the same code the host runs, so the site and the generated documentation
  cannot disagree about what the estate is.
- Renders the entity pages, the flows with their step rail and chains, the
  Problems page, the language page, the ER canvases, the C4 views the
  LikeC4 bundle carries, and the navigation around them.

## What it does not do

- Draw a C4 view itself: `likec4/` is written from the catalog by the host,
  and the site embeds the generated bundle.
- Run a plugin, read a tree or stamp anything; the fragments arrive as JSON
  through the build.
- Persist anything but a reader's own conveniences, pins and the trail, in
  the browser.

## Layout

- `catalog.ts`, `merge.ts`, `enrich.ts`, `data.ts`: the contract, the merge,
  what the merge implies, and where the sources are found.
- `pages/`, `components/`, `app/`: what a reader sees.
- `flow/`, `graph/`, `map/`, `er/`, `language/`, `table/`, `selection/`,
  `trail/`: one directory per kind of view.
- `lib/`: what the views share, one concern per file.
- `likec4/`: the generated bundle and the ids it is asked for.
- `testing/`: the frozen estate the UI tests run against.
