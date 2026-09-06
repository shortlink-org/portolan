# Start route

*Generated from the portolan catalog · commit `8 sources` · at 2026-09-05T03:58:04Z. Do not edit by hand.*

- **Id:** `flow.core-start-route`
- **Owner:** [delivery](../delivery/README.md)
- **Source:** [`examples/shop/delivery/core/src/infrastructure/transport/grpc/route/handlers.ts`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/delivery/core/src/infrastructure/transport/grpc/route/handlers.ts)

The van is out.

## Participants

| Participant | Kind | Context |
| --- | --- | --- |
| `client` | actor | — |
| `delivery.core` | service | [delivery](../delivery/README.md) |
| `core-pg` | store | [delivery](../delivery/README.md) |
| `bus` | broker | — |

## Sequence

```mermaid
sequenceDiagram
    autonumber
    actor p0 as client
    participant p1 as delivery.core
    participant p2 as core-pg
    participant p3 as bus
    p0->>p1: StartRoute → StartRouteResponse
    p1->>p2: byId
    p1->>p2: save
    p1-)p3: RouteStarted
```

## Steps

<a id="step-s1"></a>
1. **client** → **delivery.core** — StartRoute → StartRouteResponse
   status: declared · [`examples/shop/delivery/core/src/infrastructure/transport/grpc/route/handlers.ts:23`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/delivery/core/src/infrastructure/transport/grpc/route/handlers.ts#L23)
<a id="step-s2"></a>
2. **delivery.core** → **core-pg** — byId
   status: declared · [`examples/shop/delivery/core/src/application/route/usecases/start_route/usecase.ts:11`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/delivery/core/src/application/route/usecases/start_route/usecase.ts#L11)
<a id="step-s3"></a>
3. **delivery.core** → **core-pg** — save
   status: declared · [`examples/shop/delivery/core/src/application/route/usecases/start_route/usecase.ts:13`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/delivery/core/src/application/route/usecases/start_route/usecase.ts#L13)
<a id="step-s4"></a>
4. **delivery.core** → **bus** — RouteStarted
   [`delivery.core.route.RouteStarted`](../delivery/core/aggregates/route.md#event-delivery-core-route-routestarted) · status: declared · [`examples/shop/delivery/core/src/application/route/usecases/start_route/usecase.ts:13`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/delivery/core/src/application/route/usecases/start_route/usecase.ts#L13)
