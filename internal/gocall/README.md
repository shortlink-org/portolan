# Shared typed Go call facts

`Analyze(ctx, Options)` loads a project's Go packages and returns source-backed
call edges without depending on HTTP or the catalog schema. Positions are
relative to the input root and include columns. Functions retain their lexical
parents so each consumer can decide how to display closures.

Edges distinguish direct static calls from possible targets computed by VTA.
Possible targets must not be treated as proof that every implementation runs.
Consumers should retain ambiguity when assembly cannot narrow the target.
Package errors produce a partial result with diagnostics when independent
packages remain usable. If none can be analyzed, the caller receives an error.

The first consumer is `internal/gohttp`: its existing native sidecar adapts
these facts to its syntax index. Other extractors can adopt this API without
copying the package loader or depending on the HTTP scanner. The syntax-only
WASI extractors remain toolchain-free; they must not import this native loader.
Native callers must bound process execution because SSA/VTA cannot be interrupted
by a context while computing. The context does bound package loading.
