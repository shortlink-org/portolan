# extract-watermill

Watermill router and CQRS handlers, plus every publication, in; channels and
source-backed message flows out. A syntax reader over the shared Go index
(`internal/goscan`); no toolchain.

## What it reads

Every `.go` file under the input root. Handlers are the ways messages enter
the service:

- `Router.AddHandler`, `AddNoPublisherHandler` and `AddConsumerHandler`
  registrations, followed through wrappers, method values and config to the
  callers that fill their parameters;
- CQRS processors built with `NewCommandProcessor`, `NewEventProcessor` and
  their `WithConfig` forms, and the handlers given to `AddHandler`,
  `AddHandlers` and `AddHandlersGroup`;
- direct `Subscriber.Subscribe(ctx, topic)` calls.

Every function body is read for what it publishes and on which topic; a
topic is a literal, a constant, a config field's default (the environment
variable it is configured by is kept), or a parameter the callers decide. The
transport is read off the imported Pub/Sub - `watermill-kafka`,
`watermill-nats`, `watermill-amqp`, `watermill-sql` - because Watermill alone
is a library, not a transport. `if`/`else` around publications become
branches only when the condition is source-backed.

## What it emits

A fragment with one context and one service `<context>.<service>`:

- `channels`, one per topic: protocol = the transport, lowercased (empty when
  none was imported), title "Watermill / Kafka topic", doc naming the
  configuring variable when there is one, `receive` messages for handler
  inputs and `send` messages for every publication, including ones made
  outside any handler.
- `flows`, per handler: a `receive` step from the broker lane
  `watermill.<topic>` to the service (`continuesAt` the handler's entrypoint,
  consumer group noted, handoff `receive`), then a `publish` step per
  publication (handoff `send`), or an `alt` of branches when the publications
  are conditional. Trigger `event`, high confidence. A handler whose topic
  nothing resolved keeps the lane `watermill`, "topic not proven", and an
  `unresolved` step.

A tree with no registration is a warning and an empty `flows` array.

## Options

`context`, `service` (default to the input directory's name), `out`
(`watermill.json`). See `options.schema.json`.

## Manifest

```json
{
  "plugins": [{ "name": "watermill", "wasm": { "url": "file://plugins/portolan-go.wasm" } }],
  "extract": [
    { "plugin": "watermill", "in": "services/mailer", "out": "services/mailer/portolan",
      "options": { "context": "avia", "service": "mailer" } }
  ]
}
```

## Runtime

Go, part of `plugins/portolan-go.wasm` (`npm run plugins:build`), run under the
manifest name `watermill`; or `go run ./plugins/cmd/portolan-go watermill`.

## Limits

- A topic only known at run time is said to be unresolvable, with the
  expression as written.
- The transport is whichever Pub/Sub is imported first by the order above;
  nothing else about the broker is read.
- Branches whose conditions are not source-backed are listed flat.

## Tests

`go test ./plugins/extract-watermill/...`, with the fixture service under
`testdata/mailer` and its golden fragment.
