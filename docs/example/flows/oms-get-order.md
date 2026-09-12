# Get order

*Generated from the portolan catalog. Do not edit by hand.*

- **Id:** `flow.oms-get-order`
- **Owner:** [shop](../shop/README.md)
- **Source:** [`examples/shop/oms/src/infrastructure/transport/grpc/order/handlers.rs`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/oms/src/infrastructure/transport/grpc/order/handlers.rs)

Reads one order by id.

## Participants

| Participant | Kind | Context |
| --- | --- | --- |
| `client` | actor | — |
| `shop.oms` | service | [shop](../shop/README.md) |
| `oms-pg` | store | [shop](../shop/README.md) |

## Sequence

```mermaid
sequenceDiagram
    autonumber
    actor p0 as client
    participant p1 as shop.oms
    participant p2 as oms-pg
    p0->>p1: GetOrder → GetOrderResponse
    p1->>p2: by_id
```

## Steps

<a id="step-s1"></a>
1. **client** → **shop.oms** — GetOrder → GetOrderResponse
   [`examples/shop/oms/src/infrastructure/transport/grpc/order/handlers.rs:31`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/oms/src/infrastructure/transport/grpc/order/handlers.rs#L31) · Seen running in telemetry/traces.jsonl (2 traces).
<a id="step-s2"></a>
2. **shop.oms** → **oms-pg** — by_id
   status: declared · [`examples/shop/oms/src/application/order/usecases/get_order/mod.rs:42`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/oms/src/application/order/usecases/get_order/mod.rs#L42)

## Recordings

Traces this flow was seen running in, kept as examples: which steps ran, how long each took, and the names the spans carried.

- **Recording:** [`examples/shop/oms/telemetry/traces.jsonl`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/oms/telemetry/traces.jsonl)
- **Trace:** `a7416708d5eeef4f1559ce68e301d420`
- **Recorded:** 2026-09-04T19:48:30.53394Z
- **Duration:** 3.226 ms

| Step | Span | Duration | Attributes |
| --- | --- | --- | --- |
| [s1](oms-get-order.md#step-s1) | `shop.v1.OrderService/GetOrder` | 3.226 ms | `rpc.method=GetOrder` `rpc.service=shop.v1.OrderService` `rpc.system=grpc` |

- **Recording:** [`examples/shop/oms/telemetry/traces.jsonl`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/oms/telemetry/traces.jsonl)
- **Trace:** `bd903650a50496ad991b1a24134f00d9`
- **Recorded:** 2026-09-04T19:48:30.557266Z
- **Duration:** 0.794 ms

| Step | Span | Duration | Attributes |
| --- | --- | --- | --- |
| [s1](oms-get-order.md#step-s1) | `shop.v1.OrderService/GetOrder` | 0.794 ms | `rpc.method=GetOrder` `rpc.service=shop.v1.OrderService` `rpc.system=grpc` |
