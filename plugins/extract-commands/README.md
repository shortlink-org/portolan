# extract-commands

The commands a developer types against a checkout - make targets, npm scripts,
just recipes, task-runner tasks - read from the runner files themselves, never
from a README. The reading lives in `internal/commands`; this plugin wraps it
in the protocol and names the service the commands belong to.

## What it reads

The runner files at the input root, in a fixed order, the first spelling of
each that exists:

- `Makefile`, `makefile`, `GNUmakefile` - targets a person would type;
  `_`-prefixed and variable-spelled targets are not listed
- `justfile`, `Justfile`, `.justfile` - recipes
- `Taskfile.yml`/`.yaml`, `taskfile.yml`/`.yaml`, `Taskfile.dist.yml`/`.yaml`
- `package.json` - `scripts`, with the node runner detected
- `pyproject.toml` - `[tool.poe.tasks]` and `[tool.pdm.scripts]`
- `pom.xml`, `build.gradle.kts`/`build.gradle`, `.cargo/config.toml`/`config`
  aliases

Every parser is deliberately shallow: it lists entries and their descriptions
and evaluates nothing. A make target behind an `ifeq` is listed.

## What it emits

A fragment with one context and one service `<context>.<service>` whose
`commands` carry the name, description and `source` as `file:line`, spelled
from the repository the runner file lives in. Nothing else about the service
is claimed.

A runner file that cannot be read - a Taskfile that is not YAML, a
`package.json` whose `scripts` is not an object - is a warning, and the other
files are still listed. A root with no runner file warns that the fragment
lists none.

## Options

`context` (left out, the input directory's parent name - right for
`shop/cart`, wrong for a repository of its own), `service` (the input
directory's name), `out` (`commands.json`). Both ids must be slugs
(`^[a-z][a-z0-9-]*$`) or the run fails. See `options.schema.json`.

## Manifest

```json
{
  "plugins": [{ "name": "commands", "wasm": { "url": "file://plugins/portolan-go.wasm" } }],
  "extract": [
    { "plugin": "commands", "in": "examples/shop/cart", "out": "examples/shop/cart/portolan",
      "options": { "context": "shop", "service": "cart", "out": "commands.json" } }
  ]
}
```

## Runtime

Go, part of `plugins/portolan-go.wasm` (`npm run plugins:build`), run under the
manifest name `commands`; or `go run ./plugins/cmd/portolan-go commands`.

## Limits

- Only the root directory is read; a runner file in a subdirectory is not.
- A target whose name depends on a variable is not listed.

## Tests

`go test ./plugins/extract-commands/...` for the plugin, and
`go test ./internal/commands/...` for the readers and their fixtures.
