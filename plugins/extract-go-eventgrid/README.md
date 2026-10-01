# extract-go-eventgrid

Azure SDK for Go Event Grid publisher calls in, the topics and event types a
service publishes out. A syntax reader over the shared Go index
(`internal/goscan`): no toolchain, no type checker, names followed by import
path and by what the tree assigns.

## What it reads

Every `.go` file under the input root, through `goscan.Read`. The call
surface (`sites.go`):

- `azeventgrid.Client.PublishEvents` (Event Grid schema),
  `PublishCloudEvents` (CloudEvents 1.0), `PublishCustomEventEvents` (custom
  schema) - all batches;
- `aznamespaces.SenderClient.SendEvent` / `SendEvents` (CloudEvents 1.0).

The client is followed back to its constructor - `NewClient`,
`NewClientWithSAS`, `NewClientWithSharedKeyCredential`, `NewSenderClient`,
`NewSenderClientWithSharedKeyCredential` - through locals, struct fields
filled at a constructor, callees' returns and callers' arguments, up to two
hops. The endpoint string names the topic; a namespace sender's second
argument names the topic under it.

An endpoint listed in `domains` is an Event Grid domain, whose topics are
named per event: the `Topic` of an Event Grid schema event, or the `Source` of
a CloudEvent (a literal `messaging.CloudEvent{...}` or
`messaging.NewCloudEvent(source, type, ...)`). The event's `EventType`/`Type`
becomes the message name.

## What it emits

A fragment with one context and one service `<context>.<service>` whose
`channels` are the topics, sorted by address: kind `event`, protocol
`eventgrid`, title "Azure Event Grid topic", "… namespace topic" or "… domain
topic" (`<domain>/<topic>`), doc "Published through `<package>`. Published [in
batches] as `<schema>` by `Receiver.Method`.", messages with the event type
as `name` and direction `send`, and `source` at the first call site, spelled
from the repository.

Warnings name a call whose topic could not be resolved from the constructor,
a domain publish whose topic could not be read from the event, and a tree with
no publisher call at all.

## Options

`context`, `service` (both default to the input directory's name), `domains`
(domain names or endpoint URLs), `out` (`eventgrid.json`). See
`options.schema.json`.

## Manifest

```json
{
  "plugins": [{ "name": "go-eventgrid", "wasm": { "url": "file://plugins/portolan-go.wasm" } }],
  "extract": [
    { "plugin": "go-eventgrid", "in": "services/fulfillment", "out": "services/fulfillment/portolan",
      "options": { "context": "shop", "service": "fulfillment", "domains": ["estate"] } }
  ]
}
```

## Runtime

Go, part of `plugins/portolan-go.wasm` (`npm run plugins:build`), run under the
manifest name `go-eventgrid`; or `go run ./plugins/cmd/portolan-go go-eventgrid`.

## Limits

- Publishers only; nothing subscribing to Event Grid is read here. The
  topology side - subscriptions, handlers - is `extract-terraform`'s.
- An endpoint built at run time is a warning, not a channel with a hole.
- A look-alike method on another type is ignored: the receiver's type
  decides.

## Tests

`go test ./plugins/extract-go-eventgrid/...`; the fixtures are written inline
in `extract_test.go`.
