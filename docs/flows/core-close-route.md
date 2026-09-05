# Close route

*Generated from the portolan catalog · commit `5 sources` · at 2026-09-05T03:58:04Z. Do not edit by hand.*

- **Id:** `flow.core-close-route`
- **Owner:** [delivery](../delivery/README.md)
- **Source:** `examples/shop/delivery/core/src/infrastructure/transport/grpc/route/handlers.ts`

Ends the day, whatever is left undone.

## Participants

| Participant | Kind | Context |
| --- | --- | --- |
| `client` | actor | — |
| `delivery.core` | service | [delivery](../delivery/README.md) |
| `core-pg` | store | [delivery](../delivery/README.md) |

## Sequence

```mermaid
sequenceDiagram
    autonumber
    actor p0 as client
    participant p1 as delivery.core
    participant p2 as core-pg
    p0->>p1: CloseRoute → CloseRouteResponse
    p1->>p2: byId
    p1->>p2: save
```

## Steps

1. **client** → **delivery.core** — CloseRoute → CloseRouteResponse
   status: declared · `examples/shop/delivery/core/src/infrastructure/transport/grpc/route/handlers.ts:21`
2. **delivery.core** → **core-pg** — byId
   status: declared · `examples/shop/delivery/core/src/application/route/usecases/close_route/usecase.ts:8`
3. **delivery.core** → **core-pg** — save
   status: declared · `examples/shop/delivery/core/src/application/route/usecases/close_route/usecase.ts:10`
