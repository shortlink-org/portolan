# Delivery Core

Service `core` — bounded context **delivery**. TypeScript on Node.

Owns the parcel: what is being carried, where it is, and which van is taking it
there. It is told what to ship and asked where it got to; it never decides
whether something should ship at all.

## What it does

- Dispatches a planned shipment, with the tracking code the carrier gave, and
  says `ShipmentDispatched`.
- Records every sighting of every parcel, append-only.
- Ends a shipment at the door with who signed for it — `ShipmentDelivered`.
- Plans a van's day out of the shipments waiting to go out, and closes it.
- Waits for the money: nothing leaves the warehouse before the ledger says a
  payment was captured.

## What it does not do

Does not price anything, does not charge anything and does not decide what to
send. A cancelled order is asked about, not argued with: the shipment is
written off.

## Publishes

`ShipmentDispatched`, `ShipmentDelivered` on `delivery.core.shipment`;
`RoutePlanned` on `delivery.core.route`.

## Provides

`delivery.v1.Delivery` — TrackShipment, GetShipment — and
`delivery.v1.RouteService` — PlanRoute, CloseRoute, GetRoute.

## Two things the store says out loud

- `packages.order_id` is a foreign key into `shop.oms.pg.orders`, another
  service's table. It crosses a boundary knowingly — neither service can
  migrate that table alone — and the catalog reports it rather than hiding it.
- `route_stops.address` is a **copy** of `packages.ship_to`, which is itself the
  address handed over with the dispatch. A parcel on a van does not move because
  somebody edited their profile, which is why the value is copied and not looked
  up. The migration declares where the copy came from, in a `-- from:` line
  beside the column, because a table cannot show it the way a view shows a
  select. The order service is asked about the order's state and nothing else:
  it holds no address, and asking it for one would be asking the wrong service.

## Running it

```bash
docker compose up -d db
npm install && npm run gen && npm run build
```
