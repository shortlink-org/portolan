# extract-river

River job arguments, `Insert` calls and registered workers in, work queues
and source-backed job flows out. A syntax reader over the shared Go index
(`internal/goscan`), which River and Watermill share; no toolchain.

## What it reads

Every `.go` file under the input root:

- job argument types: a struct with `func (X) Kind() string` returning a
  literal, a constant or `string(...)` of one - the job's wire name;
- workers: `func (*W) Work(ctx, *river.Job[Args])`;
- registrations: `river.AddWorker(workers, w)` and `AddWorkerSafely`, where
  `w` may be a literal, a local, a constructor's result or a parameter the
  callers fill;
- the queues a `river.Config{Queues: ...}` lists;
- producers: `Insert`, `InsertTx`, `InsertMany`, `InsertManyTx`,
  `InsertManyFast`, `InsertManyFastTx`, with the job (or batch) and the
  `InsertOpts` that follow it.

A queue name is followed (`queues.go`) to a literal, a constant of the tree
or River's own (`river.QueueDefault` is `default`), a config field's default,
a struct field by what the struct is built with where it is built, a local
by every value it is given, a call into the tree by every return of the
callee, `strings.ToLower`/`ToUpper`/`TrimSpace` over any of those, and a
parameter by what the callers pass. A path only known at run time gives no
answer rather than a partial one.

## What it emits

A fragment with one context and one service `<context>.<service>`:

- `channels`, one per queue: kind `job`, protocol `river`, title "River work
  queue", messages per job kind - `send` from each producer (title the args
  type) and `receive` for the registered worker ("Handled by `W.Work`.").
- `flows`, one per job (`flow.<svc>-river-<kind>[-<queue>]`, trigger `job`,
  high confidence): an `enqueue` step from the service to the broker lane
  `river.<queue>` with a `send` handoff, and a `work` step back with a
  `receive` handoff that `continuesAt` the worker's entrypoint. A worker
  whose queue nothing proved gets the broker lane `river`, "queue not
  proven", and an `unresolved` step.

Warnings name a job inserted with no registered worker, a registered worker
no `Insert` in the tree feeds (or whose queue could not be resolved), and a
tree where nothing joined a `Kind()` to an insert or a worker.

## Options

`context`, `service` (default to the input directory's name), `out`
(`river.json`). See `options.schema.json`.

## Manifest

```json
{
  "plugins": [{ "name": "river", "wasm": { "url": "file://plugins/portolan-go.wasm" } }],
  "extract": [
    { "plugin": "river", "in": "services/billing", "out": "services/billing/portolan",
      "options": { "context": "avia", "service": "billing" } }
  ]
}
```

## Runtime

Go, part of `plugins/portolan-go.wasm` (`npm run plugins:build`), run under the
manifest name `river`; or `go run ./plugins/cmd/portolan-go river`.

## Limits

- A producer in another component is not seen; the worker is kept and the
  queue is the one the client is configured to work, when there is exactly
  one.
- Several configured queues and no `InsertOpts` naming one leaves the queue
  unresolved, said at the worker.

## Tests

`go test ./plugins/extract-river/...`; fixtures are inline in
`extract_test.go` and `queues_test.go`.
