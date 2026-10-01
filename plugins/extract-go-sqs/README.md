# extract-go-sqs

aws-sdk-go-v2 SQS calls in, the queues a service sends to and receives from
out. The twin of `extract-go-nats`: the same shared Go index, the same
port-following, a queue instead of a subject.

## What it reads

Every `.go` file under the input root, through `internal/goscan`. Three
methods, on `*sqs.Client` and nothing else (`sites.go`): `SendMessage`,
`SendMessageBatch` (send) and `ReceiveMessage` (receive). The queue is always
the `QueueUrl` field of the input struct - written inline as
`&sqs.SendMessageInput{QueueUrl: ...}` or built into a local first.

The value is followed with the SDK's wrapping taken off: `aws.String` and
`aws.ToString`, a local given one of those, and the `QueueUrl` of a
`GetQueueUrl` result, which is read as the `QueueName` that was asked for.
What remains is resolved to a literal, a constant, a config field's default,
a struct field at the constructor that filled it, or a caller's argument, up
to two hops. A URL is reduced to its last path segment, the queue's name. As
with NATS, one other string parameter beside the queue on a port
(`Send(ctx, queue, name, payload)`) names the message.

## What it emits

A fragment with one context and one service `<context>.<service>` whose
`channels` are the queues, sorted: kind `message`, protocol `sqs`, title "SQS
queue", doc "Read through github.com/aws/aws-sdk-go-v2/service/sqs." plus one
sentence per site ("Sent by `Receiver.Method`.", "Sent in batches by …",
"Received by …"), messages from the companion string with their direction,
and `source` at the first site, spelled from the repository.

Warnings name a call whose input was not written as `&sqs.XInput{QueueUrl:
...}` in the function, a queue that could not be resolved, and a tree with no
SQS call.

## Options

`context`, `service` (default to the input directory's name), `out`
(`sqs.json`). See `options.schema.json`.

## Manifest

```json
{
  "plugins": [{ "name": "go-sqs", "wasm": { "url": "file://plugins/portolan-go.wasm" } }],
  "extract": [
    { "plugin": "go-sqs", "in": "services/fulfillment", "out": "services/fulfillment/portolan",
      "options": { "context": "shop", "service": "fulfillment" } }
  ]
}
```

## Runtime

Go, part of `plugins/portolan-go.wasm` (`npm run plugins:build`), run under the
manifest name `go-sqs`; or `go run ./plugins/cmd/portolan-go go-sqs`.

## Limits

- Only the three calls above are read; `CreateQueue`, SNS, and queue
  attributes are not.
- A queue further than two hops from a literal stays unresolved and is said
  at the call.
- A `Send` on a type other than `*sqs.Client` is ignored.

## Tests

`go test ./plugins/extract-go-sqs/...`; fixtures are inline in
`extract_test.go`, including the constructor-field and `GetQueueUrl` cases.
