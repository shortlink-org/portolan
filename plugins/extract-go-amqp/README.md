# Go AMQP extractor

`extract-go-amqp` (manifest name `go-amqp`) reads what a Go service publishes
to and consumes from RabbitMQ through `github.com/rabbitmq/amqp091-go` or its
predecessor `github.com/streadway/amqp`. It parses the source and never builds
it. A call is known by being made on `*amqp.Channel` - typed through
`amqp.Dial` and `Connection.Channel`, a field, or a parameter - never by its
name alone: a service's own bus port has a `Publish` too.

## What is read

- `Publish`, `PublishWithContext`, `PublishWithDeferredConfirm` and
  `PublishWithDeferredConfirmWithContext`: the exchange and the routing key.
- `Consume`, `ConsumeWithContext` and `Get`: the queue.
- `QueueBind(queue, key, exchange, ...)`: which exchange and key feed a queue.
- `ExchangeDeclare`: the exchange's type, including the `amqp.ExchangeFanout`
  family of constants.
- `QueueDeclare`: `q.Name` of a local given `QueueDeclare("orders", ...)` is
  `orders`. A queue declared with an empty name is one the server names; a
  binding and a consume of the same `q.Name` meet at that declaration.

The exchange, the key and the queue are followed as `extract-go-nats` follows
a subject: literal, constant, config default, one-return function, a field
filled by the constructor, or a parameter up to two hops through the callers.
When the exchange and the key are both parameters, they are read together at
each caller, so one caller's exchange never meets another caller's key. When
the port takes exactly one other string beside the key, it names the message.
Anything still not a string is a warning at the call, never a guess.

## How a route becomes a channel

A catalog channel is one address that a publisher and a consumer meet on, and
a channel has one publisher. RabbitMQ has no single such string: a message is
published to an exchange with a routing key, and consumed from a queue that
bindings fill. The address is therefore the string the broker routes by:

| Route | Address | Kind | Title |
| --- | --- | --- | --- |
| default exchange `""`, key `k` | `k` - the queue of that name | `message` | AMQP queue |
| exchange `e`, key `k` (direct or topic) | `k` | `event` | AMQP routing key |
| exchange `e` that is fanout or headers, or published with no key | `e` | `event` | AMQP exchange |

A consume reads through its queue's bindings: each `QueueBind` in the tree
places the consumer on the address its exchange and key give by the same
table. A queue nothing binds is reached through the default exchange by its
own name, so an unbound consumer's address is the queue, and a publisher to
`""` with that key meets it. A server-named queue that nothing binds says
nothing and is a warning.

This follows the AsyncAPI AMQP binding, where the channel address is the
routing key and the exchange and queue are bindings on it, so a document
written that way and read by `extract-asyncapi` lands on the same address. Keying on the exchange alone was
the alternative: every service publishing to a shared topic exchange
(`shop.events`, `amq.topic`) would then be a second publisher on one channel.
The exchange, the queue and the binding are in each channel's doc.

A topic-exchange binding with a wildcard (`order.*`, `#`) is kept as written,
so it meets no publisher's key; matching patterns is left for later, as it is
for NATS subjects.

```json
{
  "plugin": "go-amqp",
  "in": "services/orders",
  "out": "services/orders/portolan",
  "options": { "context": "shop", "service": "orders" }
}
```

## Left out

Wildcard matching of topic bindings; `ExchangeBind` (exchange to exchange);
headers-exchange arguments; `QueueDeclare` names passed through a parameter
as `q.Name`; dead-letter and alternate exchanges declared in queue arguments;
RPC reply queues; message properties such as `Type` or `ContentType`.
