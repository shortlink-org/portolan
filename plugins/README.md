# Generators

A generator turns the catalog into something else — markdown here, and
whatever comes next in its own directory beside it.

The contract is one JSON message in and one JSON message out:

```
→ { "portolanVersion": "0.1.0", "catalog": { ... }, "options": { ... } }
← { "files": [{ "name": "shop/oms/README.md", "contents": "..." }],
    "diagnostics": [{ "severity": "warning", "message": "...", "ref": "..." }] }
```

A generator **names** files; it never writes them. `scripts/gen.mjs` writes what
comes back, refuses a name that points outside the output directory, and deletes
pages that stopped being generated. That is what lets a generator run as a wasm
module with no directory preopened at all — the sandbox is not a restriction
worked around, it is the reason the protocol has this shape.

Three obligations, and they are the whole of it:

1. **Valid output.** Every file a generator names is committed and read.
2. **Determinism.** The same catalog produces byte-identical output, so
   reviewing generated documentation is reviewing a diff. Sort anything that
   comes out of a map; never read a clock.
3. **Diagnostics over silence.** Something that cannot be rendered faithfully —
   a dangling reference, an event with no versions — is reported beside the
   output, not papered over inside it.

## Adding one

1. Write it. In Go, a new directory here with a `main` that reads stdin and
   writes stdout; `catalog.Catalog` from `github.com/shortlink-org/portolan/catalog`
   is the mirror of the schema. In any other language, anything that speaks the
   protocol above.
2. Build it. For a wasm plugin, `GOOS=wasip1 GOARCH=wasm go build`. Add the
   line to `plugins:build` in `package.json`.
3. Declare it in `portolan.json`, under `plugins` (how to run it) and
   `generate` (what to run it on).

```json
{
  "plugins": [
    { "name": "markdown", "wasm": { "url": "file://plugins/gen-markdown.wasm" } }
  ],
  "generate": [
    { "plugin": "markdown", "out": "docs", "options": { "title": "Example estate" } }
  ]
}
```

## wasm or process

`wasm` is the default and should stay that way. The module gets no filesystem,
no network and no environment; a plugin from somebody else's repository can be
run over your source tree without reading it.

`process` is the escape hatch for a generator that needs a toolchain — one
reading Go source has to run `go list`, and no wasm module can spawn anything.
It gets the same protocol and none of the sandbox, which is the trade being made
and the reason it is not the default.

A plugin fetched over `https://` must declare its `sha256`; the host verifies it
and caches by digest. A `file://` plugin may declare one, but a checksum
protects a download, not a module built from the source next to it.
