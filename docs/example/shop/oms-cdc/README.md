# oms-cdc

*Generated from the portolan catalog. Do not edit by hand.*

- **Id:** `shop.oms-cdc`
- **Context:** [Shop](../README.md)
- **Path:** [`examples/shop/oms/connectors/oms-cdc.yaml/`](https://github.com/shortlink-org/portolan/tree/main/examples/shop/oms/connectors/oms-cdc.yaml)
- **Kind:** data-pipeline
- **Technologies:** Debezium, Kafka Connect, PostgreSQL
- **Owners:** `@shortlink-org/shop-oms`, `@shortlink-org/platform`

## Channels

### shop.oms.public.order_lines

`message stream`

**Kafka topic**

Debezium change-data-capture topic.

Source: [`examples/shop/oms/connectors/oms-cdc.yaml:1`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/oms/connectors/oms-cdc.yaml#L1)

| Direction | Message | Encoding | Title | Doc |
| --- | --- | --- | --- | --- |
| send | `shop.oms.public.order_lines.Envelope` | avro | Shop Oms Public Order Lines | Row changes captured from `public.order_lines`. |

### shop.oms.public.orders

`message stream`

**Kafka topic**

Debezium change-data-capture topic.

Source: [`examples/shop/oms/connectors/oms-cdc.yaml:1`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/oms/connectors/oms-cdc.yaml#L1)

| Direction | Message | Encoding | Title | Doc |
| --- | --- | --- | --- | --- |
| send | `shop.oms.public.orders.Envelope` | avro | Shop Oms Public Orders | Row changes captured from `public.orders`. |

## Stores

| Store | Kind | Access | Schema |
| --- | --- | --- | --- |
| [Order database](../oms/stores/pg.md) | postgres | reads | 3 tables |
