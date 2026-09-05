# Delivery Core

Service `core` — bounded context **delivery**. TypeScript on Node.

Owns the shipment: what is being carried, where it is, and which van is taking
it there. It is told what to ship and asked where it got to; it never decides
whether something should ship at all. The vocabulary is [GLOSSARY.md](GLOSSARY.md).

## What it does

- Dispatches a planned shipment, with the tracking code the carrier gave, and
  says `ShipmentDispatched`.
- Records every sighting of every parcel, append-only.
- Ends a shipment at the door with who signed for it — `ShipmentDelivered`.
- Plans a van's day out of the shipments waiting to go out, and closes it.
- Waits for the money: every shipment starts `awaiting-payment`, and nothing
  leaves the warehouse before the ledger says the payment was captured. The
  fact releases it - `ShipmentReleased` - and only then can it be planned and
  dispatched (core.0002).

## What it does not do

Does not price anything, does not charge anything and does not decide what to
send. A cancelled order is asked about, not argued with: the shipment is
written off.

## Publishes

`ShipmentReleased`, `ShipmentDispatched`, `ShipmentInTransit`,
`ShipmentDelivered`, `ShipmentLost` on `delivery.core.shipment`;
`RoutePlanned`, `RouteStarted`, `RouteClosed` on `delivery.core.route`. Every
arrow of both lifecycle tables is one of these.

## Provides

`delivery.v1.Delivery` — TrackShipment, GetShipment — and
`delivery.v1.RouteService` — PlanRoute, CloseRoute, GetRoute.

## Two things the store says out loud

- `packages.order_id` is a foreign key into `shop.oms.pg.orders`, another
  service's table. It crosses a boundary knowingly — neither service can
  migrate that table alone — and the catalog reports it rather than hiding it
  (core.0001).
- `route_stops.address` is a **copy** of `packages.ship_to`, which is itself the
  address handed over with the dispatch. A parcel on a van does not move because
  somebody edited their profile, which is why the value is copied and not looked
  up. The migration declares where the copy came from, in a `-- from:` line
  beside the column, because a table cannot show it the way a view shows a
  select. The order service is asked about the order's state and nothing else:
  it holds no address, and asking it for one would be asking the wrong service.

## Decisions

- [core.0001](docs/adr/0001-packages-order-id-is-a-foreign-key-into-another-service.md)
  — `packages.order_id` is a foreign key into the order service's table,
  knowingly.
- [core.0002](docs/adr/0002-a-shipment-waits-for-the-money.md) — a shipment
  waits for the money, and the ledger's fact releases it.

## Status

A sketch for the catalog, not the reference service; `examples/auth` is
that. What it has: two aggregates whose lifecycle tables are enforced and
whose every move is an event, use cases that answer with what a caller may
see, a policy that reacts to the ledger's fact through a use case, and the
records above. What it deliberately does not have yet, and the review skill
will name: no repository or server behind the ports, so nothing here runs;
no version on the aggregates; no unit of work, so `plan_route` writes a
route and its shipments one save at a time; no sentinel errors or status
mapping at the edge; no tests; no tracing. Each is a known gap, not an
oversight, and none of them changes what the catalog shows.

## Running it

```bash
docker compose up -d db
npm install && npm run gen && npm run build
```
