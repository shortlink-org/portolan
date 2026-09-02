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

## Schema modules: fetch and parse, kept apart

`fetch-bsr` and `extract-proto` are two plugins on purpose, and the split is
the whole design.

| | `fetch-bsr` | `extract-proto` |
| --- | --- | --- |
| job | registry wire → `.proto` bytes | `.proto` bytes → catalog fragment |
| network | yes | never |
| environment | reads `BUF_TOKEN` | never |
| output | `.proto` files and a `bsr.lock.json` per module | one catalog fragment |
| deterministic | only because it is pinned and cached | absolutely |

Extraction stays a pure function of the tree. Fetching is the step that can
fail, need a credential, or come back with something different than it did
yesterday, and confining that to its own step is what lets everything after it
be replayed byte-for-byte from a checkout.

**The fetched protos are the plugin's `Response.Files`, not a side effect.** The
host writes them like any other generated file, so they get a manifest entry,
are compared by `gen:check`, and are removed when the step stops naming them.
The cache is not a second copy of anything — it *is* the tree. Refreshing a pin
produces one pull request holding the pin bump, the proto diff, the lock diff
and the fragment diff, which is the review worth having.

Declare the fetch step **before** the extract step: steps run in list order, so
its protos and locks are on disk by the time the parser reads them.

```json
{
  "plugins": [
    { "name": "bsr",   "process": { "cmd": "go run ./plugins/fetch-bsr" } },
    { "name": "proto", "process": { "cmd": "go run ./plugins/extract-proto" } }
  ],
  "extract": [
    {
      "plugin": "bsr",
      "in": "examples/shop",
      "out": "examples/shop/vendor/proto",
      "options": {
        "cache": "examples/shop/vendor/proto",
        "modules": [
          { "module": "buf.build/acme/shop", "commit": "c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6" }
        ]
      }
    },
    {
      "plugin": "proto",
      "in": "examples/shop",
      "out": "examples/shop/portolan",
      "options": {
        "context": "shop",
        "service": "oms",
        "paths": ["vendor/proto/acme/shop"],
        "vendored": ["internal/infrastructure/pricing"],
        "peers": { "pricing.v1": "shop.pricing" },
        "out": "proto.json"
      }
    }
  ]
}
```

`cache` repeats the step's `out` because a plugin is never told where its output
goes. That is the shape of the protocol — a plugin returns files and the host
decides what to do with them — and not an oversight to work around.

### Why fetch-bsr can never be wasm

It needs a socket and a credential. `process` exists for exactly that trade, and
`auth.go` is the only file in either plugin that reads the environment. The
protocol's "no ambient state" rule is about *facts*: nothing about the estate may
come from anywhere but the request. A credential is not a fact about the estate —
it decides whether the fetch succeeds, never what the fetch says — and a test
asserts the output is byte-identical with and without a token.

### Pinning, and the offline rule

Pin every module to a commit. A BSR commit is immutable, so a pinned download is
byte-reproducible, which is the only reason replaying from disk is equivalent to
fetching again. An unpinned module is resolved and warned about when online, and
refused when offline — there is nothing to replay against.

`PORTOLAN_OFFLINE=1` (or any truthy `CI`) turns the fetch off. The step then
re-emits the committed copies, checked against their locks. Set it in CI; the
workflow already does.

Four rules govern what happens when a fetch does not:

1. Fetch succeeded → the fetched files and a regenerated lock.
2. Skipped or failed, cache complete and matching its digests → the cached files
   byte-identically, plus a warning. Output unchanged, so `--check` stays clean.
3. Failed **and** no usable cache → a non-zero exit, never a short file list. The
   host deletes files a step stops naming, and dropping a repository's vendored
   protos because a laptop went offline is worse than a red build.
4. A cached file whose digest no longer matches is reported by path — someone
   edited a vendored copy, which is the drift `docs/adr/org.0001.md` wants seen.

### Why the proto parser is hand-written

`docs/adr/org.0001.md` has consumers keeping *narrowed* vendored copies, and a
narrowed copy routinely imports a file nobody vendored beside it. A compiler —
`protocompile`, `protoc` — refuses to produce anything for that input. The whole
point of reading vendored copies is to describe files that do not build
standalone, so the parser is tolerant: every construct it declines to model
(`extend`, a proto2 `group`, an aggregate option body) is named in a diagnostic
rather than dropped, and only a file that cannot be tokenised is fatal.

It also keeps types **as written** — `[]LineItem`, `map[string]Money`, the
`optional` keyword, the author's declaration order — the same stance the catalog
already takes for schemas, and one a descriptor has already thrown away.

### What extract-proto will not claim

`status` is only ever `declared` or `unresolved`, **never `verified`**. Reading a
`.proto` proves a call was written down. `verified` in the shipped catalog means
a test exercises it end to end, which is a property of the merged catalog — and
every extractor runs before one exists.

A message named `OrderPlaced` in an `events.proto` stays an `RpcMessage` and does
not become a catalog `Event`. `Event.id` is `<service>.<aggregate>.<Name>` and
this extractor knows the package, not the aggregate; a guess would collide with
the event `extract-go` already emits, or invent a ghost aggregate that would sit
beside the real one forever.
