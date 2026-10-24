{
  "connector.class": "io.debezium.connector.postgresql.PostgresConnector",
  "topic.prefix": "gavel-auction-public",
  "table.include.list": "public.auction_outbox",
  "value.converter": "org.apache.kafka.connect.converters.ByteArrayConverter",
  "transforms": "unwrap,extract,route",
  "transforms.unwrap.type": "io.debezium.transforms.ExtractNewRecordState",
  "transforms.extract.type": "org.apache.kafka.connect.transforms.ExtractField$Value",
  "transforms.extract.field": "payload",
  "transforms.route.type": "org.apache.kafka.connect.transforms.RegexRouter",
  "transforms.route.regex": ".*",
  "transforms.route.replacement": "gavel.auction.public.v1"
}
