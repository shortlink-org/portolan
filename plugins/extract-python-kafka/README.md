# Python Kafka extractor

`extract-python-kafka` reads Kafka client construction and calls from Python
syntax. It does not import or execute the project and it does not require a
Django, Flask, or other framework layout.

Supported clients:

- `confluent_kafka.Producer.produce` and `Consumer.subscribe`;
- `kafka.KafkaProducer.send` and constructor-based `KafkaConsumer` topics;
- `aiokafka.AIOKafkaProducer.send` / `send_and_wait` and constructor-based
  `AIOKafkaConsumer` topics.

Literal topics, module constants, imported constants, environment defaults and
optional `settings.NAME` references are followed. Local producer factories are
followed to a supported constructor, so a singleton wrapper does not hide the
client. Topics that remain dynamic are reported and no channel is guessed.

The output uses generic `message` channels rather than domain events. It keeps
source-backed broker, security mode, idempotence, retry, compression, client
id, consumer group, key, headers and serializer facts. Authentication values
are never emitted. Partitions, replication and retention are broker-side facts
and remain explicitly unknown unless another catalog source declares them.

```json
{
  "plugin": "python-kafka",
  "in": "checkout",
  "out": ".portolan/fragments/checkout-kafka",
  "options": {
    "context": "shop",
    "service": "checkout",
    "settings": "config.settings"
  }
}
```
