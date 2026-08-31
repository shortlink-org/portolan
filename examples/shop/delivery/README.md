# Delivery & Fulfilment

Service `shop.delivery` — bounded context **shop**.

Owns physical fulfilment: from a confirmed order to a parcel at a door. It is
the service that knows where things are, which is a different question from
what was bought.

## What it does

- Turns a confirmed order into one or more shipments — a split by warehouse is
  normal, so one order is not one parcel.
- Reserves stock and picks a carrier per shipment against cost and promised
  date.
- Tracks shipments by polling carriers and ingesting their tracking webhooks,
  and publishes the state changes worth telling anyone about.
- Handles the return leg: return labels, receipt at the warehouse, and the
  signal that lets `shop.billing` refund.

## What it does not do

Does not price shipping (the cart does, at checkout) and never touches money.
Carrier invoices are reconciled elsewhere.

## Publishes

`ShipmentCreated`, `ShipmentDispatched`, `ShipmentDelivered`,
`ShipmentFailed`, `ReturnReceived`.
