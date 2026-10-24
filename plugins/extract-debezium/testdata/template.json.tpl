{
  "name": "templated-cdc",
  "config": {
    "connector.class": "io.debezium.connector.postgresql.PostgresConnector",
    "topic.prefix": "gavel",
    "table.include.list": "public.orders",
    "value.converter": "org.apache.kafka.connect.json.JsonConverter"
  }
}
