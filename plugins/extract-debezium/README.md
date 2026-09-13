# Debezium extractor

`extract-debezium` reads PostgreSQL Debezium declarations from Kafka Connect
JSON request bodies and Strimzi `KafkaConnector` YAML. It emits one
`data-pipeline` component per connector, the store it reads when the manifest
maps one, Kafka channels whose exact names the configuration proves, and a flow
from the source table through the connector to Kafka.

It reads configuration only. A running connector's task state and lag are
observations for a verifier, not reproducible source facts.

For ordinary CDC, a row change is a generic message rather than a domain event.
With `io.debezium.transforms.outbox.EventRouter`, the application that wrote the
outbox remains the logical publisher and Debezium is the relay. Supply that
service plus the finite route values that only the rows themselves contain:

```json
{
  "plugin": "debezium",
  "in": "deploy",
  "out": "portolan/debezium",
  "options": {
    "context": "data-platform",
    "paths": ["connectors"],
    "connectors": {
      "orders-outbox": {
        "store": "shop.orders.pg",
        "sourceService": "shop.orders",
        "routes": [
          {
            "value": "orders",
            "message": "shop.orders.OrderPlaced"
          }
        ]
      }
    }
  }
}
```

The first release intentionally requires literal `schema.table` entries in
`table.include.list` and the default topic naming strategy. A regular-expression
capture set or a topic-routing SMT can describe an unbounded set, so the
extractor reports it instead of inventing finite channels. It recognizes
`ExtractNewRecordState` and the Outbox Event Router. Only PostgreSQL connectors
are read; other Debezium connector classes are reported and left alone.

No connector property is copied wholesale. In particular, database passwords,
Kafka credentials and Schema Registry credentials cannot enter the generated
fragment.
