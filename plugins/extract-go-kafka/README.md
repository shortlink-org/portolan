# Go Kafka extractor

`extract-go-kafka` (manifest name `go-kafka`) reads the Kafka topics a Go
service produces to and consumes from. It parses the source and never builds
it, so the client libraries need not be in any `go.mod`: a call is known by
the import path of the type it is made on or the struct it builds, never by a
method name alone - a service's own port has a `Consume` too, and it is not
this one.

## What is read

| Client | Produces | Consumes |
| --- | --- | --- |
| `github.com/IBM/sarama`, `github.com/Shopify/sarama` | `sarama.ProducerMessage{Topic}`, wherever it is built - handed to `SendMessage`, `SendMessages`, or sent down `AsyncProducer.Input()` | `ConsumerGroup.Consume(ctx, topics, handler)`, `Consumer.ConsumePartition(topic, ...)` |
| `github.com/segmentio/kafka-go` | `kafka.Writer{Topic}`, `kafka.WriterConfig{Topic}`, `kafka.Message{Topic}` | `kafka.ReaderConfig{Topic, GroupTopics, GroupID}` |
| `github.com/confluentinc/confluent-kafka-go` (and `/v2`) | `kafka.Message{TopicPartition: kafka.TopicPartition{Topic: &t}}` | `Consumer.Subscribe(topic, ...)`, `Consumer.SubscribeTopics(topics, ...)` |
| `github.com/twmb/franz-go/pkg/kgo` | `kgo.Record{Topic}`, `kgo.DefaultProduceTopic(t)` | `kgo.ConsumeTopics(...)`, `Client.AddConsumeTopics(...)` |

A client struct that carries a topic is the declaration wherever it is built:
nothing else is built from those types, and the call it is later handed to may
be a long way off. A `kafka.Writer` with no `Topic` sends each message where
the message says, and a `kgo.Record` with none goes to the client's default,
so neither is a site of its own.

## How a topic is followed

As in `extract-go-nats`: a literal, a constant (the tree's own or an imported
one), a config field's `default` tag, a function whose body is one `return`,
a concatenation of those, or a parameter - followed up to two hops through the
callers, including calls through an interface the adapter satisfies. A field
of the receiver is read at the constructor that filled it, the producer's shape
where the topic comes in at `New` and is read at `Publish`. A list of topics
is followed through a slice literal, a local given one, a list parameter, or a
variadic tail each caller spells out.

When the port takes exactly one other string beside the topic, that string is
the message's name. A topic that is still not a string - an outbox row's
field, `os.Getenv`, `strings.Split` - is a warning at the site and no channel:
it is never guessed.

The consumer group is documentation, read where the code names it in the same
function: `sarama.NewConsumerGroup(addrs, group, cfg)`, `ReaderConfig.GroupID`,
confluent's `ConfigMap{"group.id": ...}`, or a `kgo.ConsumerGroup` option passed
beside `kgo.ConsumeTopics`.

## What comes out

One `message` channel per topic, protocol `kafka`, title `Kafka topic` - the
shape `extract-python-kafka`, `extract-debezium` and the Schema Registry
reader give a topic, so the same topic read from two languages lands on one
channel. The doc says which client read it and who produces or consumes it,
with the consumer group when there is one.

```json
{
  "plugin": "go-kafka",
  "in": "services/billing",
  "out": "services/billing/portolan",
  "options": { "context": "shop", "service": "billing" }
}
```

## Left out

`kgo.ConsumeRegex` and other pattern subscriptions; confluent's
`Consumer.Assign`; kafka-go's low-level `kafka.Conn` (`DialLeader`), which
reads and writes on one connection; a client struct built at package level
rather than in a function; a `Topic` set by assignment after the literal;
admin calls that create or delete topics; partitions, keys, headers and
serializers.
