# extract-go-nats

nats.go and JetStream calls in, the subjects a service listens on and
publishes to out. Read through the port that wraps them: an adapter that
takes the subject as a parameter and an assembly that passes a constant is
one declaration, and the reader follows it. A syntax reader over
`internal/goscan`; no toolchain.

## What it reads

Every `.go` file under the input root. The surface is keyed by the type a
method is called on (`sites.go`), so a service's own bus port with a
`Subscribe` is not mistaken for NATS:

- `*nats.Conn`: `Subscribe`, `SubscribeSync`, `ChanSubscribe`,
  `QueueSubscribe`, `QueueSubscribeSync`, `ChanQueueSubscribe` (receive);
  `Publish`, `Request`, `PublishMsg`, `RequestMsg` (send).
- legacy `nats.JetStreamContext`: the same subscribes plus `PullSubscribe`;
  `Publish`, `PublishAsync`, `PublishMsg`, `PublishMsgAsync`.
- `jetstream.JetStream`: `Publish`, `PublishAsync`, `PublishMsg`,
  `PublishMsgAsync`; `CreateOrUpdateConsumer`, `CreateConsumer`,
  `UpdateConsumer`, `OrderedConsumer`, and the same four on
  `jetstream.Stream`.

The subject is the argument, the subject a `*nats.Msg` was built with
(`nats.NewMsg(x)`, `&nats.Msg{Subject: x}`, or a local given one), or a
consumer config's `FilterSubject`/`FilterSubjects`. It is resolved to a
literal, a constant, a config field's default, or a caller's argument, up to
two hops up the callers. The one other string parameter beside the subject
is taken to name the message, the shape of a port
`Subscribe(subject, name, handler)`. A queue group and a durable name
(`Durable` field, or the legacy `nats.Durable(...)` option) are read as
documentation.

## What it emits

A fragment with one context and one service `<context>.<service>` whose
`channels` are the subjects, sorted: kind `event`, protocol `nats`, title
"NATS subject" or "JetStream subject", doc "Read through
github.com/nats-io/nats.go." followed by one sentence per site ("Published by
`Receiver.Method` over JetStream, durable consumer `x`, queue group `y`."),
messages named by the companion string with their direction, and `source` at
the first site, spelled from the repository.

Warnings name a call whose message was not built in the function, a consumer
with no filter subject, a subject that could not be resolved, and a tree with
no nats.go call.

## Options

`context`, `service` (default to the input directory's name), `out`
(`nats.json`). See `options.schema.json`.

## Manifest

```json
{
  "plugins": [{ "name": "go-nats", "wasm": { "url": "file://plugins/portolan-go.wasm" } }],
  "extract": [
    { "plugin": "go-nats", "in": "examples/shop/pricing", "out": "examples/shop/pricing/portolan",
      "options": { "context": "shop", "service": "pricing", "out": "nats.json" } }
  ]
}
```

## Runtime

Go, part of `plugins/portolan-go.wasm` (`npm run plugins:build`), run under the
manifest name `go-nats`; or `go run ./plugins/cmd/portolan-go go-nats`.

## Limits

- A subject further than two hops from a literal is not followed.
- A subject is taken as the string written; a wildcard is a subject like any
  other.
- Stream definitions are not read; only the consumer's filter subjects are.

## Tests

`go test ./plugins/extract-go-nats/...`; fixtures are inline in
`extract_test.go`, including a declaration-order permutation test.
