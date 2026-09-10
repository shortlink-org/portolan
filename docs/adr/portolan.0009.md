# portolan.0009 — The typed Go call graph runs as a native sidecar

*Generated from the portolan catalog · commit `5 sources` · at 2026-09-06T20:39:44+07:00. Do not edit by hand.*

- **Status:** accepted
- **Date:** 2026-09-10
- **Scope:** [portolan](../portolan/README.md)
- **Source:** [`adr/0009-the-typed-go-call-graph-runs-as-a-native-sidecar.md`](https://github.com/shortlink-org/portolan/blob/main/adr/0009-the-typed-go-call-graph-runs-as-a-native-sidecar.md)

### Context and Problem Statement

The HTTP client extractor has two layers. Its syntax pass reads outbound calls,
contracts, routes and factories directly from the tree. When interface dispatch
hides the remaining edge, it loads the project with `go/packages`, builds SSA,
and applies VTA. That second layer was placed in the same `wasip1` module as the
syntax extractors.

`go/packages` does not load a module from files alone. It invokes the Go
toolchain and communicates with it over pipes. A WASI module has neither
processes nor pipes, so a project that needed the typed edge always reported
`pipe: Not implemented on wasip1` and silently kept the less precise syntax
result. The failure depended on the source shape: the capability appeared
available until a sufficiently indirect call graph exercised it.

### Decision Drivers

- Interface calls must keep the precision of the existing SSA/VTA analysis.
- Build tags, replacements, private modules and the project's Go version must
  have the same meaning they have to the project.
- A toolchain requirement must be visible to `init` and `doctor` before the
  extractor runs.
- Extractors that only read syntax should retain the small, toolchain-free WASI
  path chosen in portolan.0006.

### Considered Options

1. **Run only `http-clients` as a native Go sidecar.**
2. Reimplement enough of module loading and type checking inside WASI.
3. Keep the runtime fallback and make its warning more prominent.
4. Ship one prebuilt analyzer binary for every supported platform.

### Decision Outcome

Chosen option: **run only `http-clients` as a native Go sidecar**.

The built-in is declared as a Go process instead of an entry in
`portolan-go.wasm`. The package ships the command and its transitive Go source.
The process adapter builds that command into `.portolan/bin/go` using
Portolan's shipped module, then executes the binary with the user's workspace
as its current directory. The plugin protocol is unchanged: one request on
stdin, one response on stdout, named output files, and bounded execution.
The analyzer canonicalizes the request's root before matching AST positions to
SSA positions; manifests normally pass `.` or another relative path, while the
Go loader reports absolute filenames.

Building and running are deliberately separate. Running `go run` from the
workspace cannot resolve Portolan's module; running it from the installed
package makes the relative input root point at the package instead of the
project. A native binary has neither ambiguity. Rebuilding on each invocation
lets the Go build cache do the reuse and prevents a package upgrade from
leaving a stale workspace sidecar.

Reimplementing module loading inside WASI was rejected because it would be a
second, incomplete Go build system and would still need dependency source that
the sandbox does not expose. A warning-only fallback loses the exact quality
this pass exists to add. A binary matrix repeats the packaging burden WASI
removed for every other Go extractor.

#### Consequences

- Good: typed interface edges use the existing `go/packages`, SSA and VTA path
  against the real project module.
- Good: `init` and `doctor` derive the Go requirement from the plugin
  declaration; other Go extractors still require only Node and WASI.
- Good: the capability no longer fails conditionally inside WASI.
- Bad: selecting `http-clients` requires a Go toolchain and grants this trusted
  built-in process access to the workspace and the process environment.
- Bad: the npm package includes the analyzer's Go source and module metadata.
