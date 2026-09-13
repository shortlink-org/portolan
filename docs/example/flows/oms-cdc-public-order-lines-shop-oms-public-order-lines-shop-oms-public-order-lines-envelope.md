# oms-cdc · public.order_lines · CDC

*Generated from the portolan catalog. Do not edit by hand.*

- **Id:** `shop.oms-cdc.oms-cdc-public-order-lines-shop-oms-public-order-lines-shop-oms-public-order-lines-envelope`
- **Owner:** [shop](../shop/README.md)
- **Trigger:** `startup` · Kafka Connect task
- **Root confidence:** high
- **Source:** [`examples/shop/oms/connectors/oms-cdc.yaml:1`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/oms/connectors/oms-cdc.yaml#L1)

Debezium captures public.order_lines and relays it to Kafka from the connector configuration.

## Participants

| Participant | Kind | Context | Entity | Label |
| --- | --- | --- | --- | --- |
| `oms-cdc-source` | store | [shop](../shop/README.md) | [shop.oms.pg](../shop/oms/stores/pg.md) | public.order_lines |
| `shop.oms-cdc` | service | [shop](../shop/README.md) | [shop.oms-cdc](../shop/oms-cdc/README.md) | — |
| `oms-cdc-kafka` | broker | — | — | Kafka |

## Sequence

```mermaid
sequenceDiagram
    autonumber
    participant p0 as public.order_lines
    participant p1 as shop.oms-cdc
    participant p2 as Kafka
    p0->>p1: capture public.order_lines
    p1-)p2: publish shop.oms.public.order_lines.Envelope
```

## Steps

<a id="step-capture"></a>
1. **oms-cdc-source** → **shop.oms-cdc** — capture public.order_lines
   status: declared · [`examples/shop/oms/connectors/oms-cdc.yaml:1`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/oms/connectors/oms-cdc.yaml#L1) · The connector configuration declares this table in table.include.list. · evidence: configuration · debezium-table-include · `public.order_lines` · [`examples/shop/oms/connectors/oms-cdc.yaml:1`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/oms/connectors/oms-cdc.yaml#L1)
<a id="step-publish"></a>
2. **shop.oms-cdc** → **oms-cdc-kafka** — publish shop.oms.public.order_lines.Envelope
   status: declared · [`examples/shop/oms/connectors/oms-cdc.yaml:1`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/oms/connectors/oms-cdc.yaml#L1) · handoff: send · message · kafka · shop.oms.public.order_lines · shop.oms.public.order_lines.Envelope · evidence: configuration · debezium-default-topic · `shop.oms.public.order_lines` · [`examples/shop/oms/connectors/oms-cdc.yaml:1`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/oms/connectors/oms-cdc.yaml#L1)
