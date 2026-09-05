# Glossary — Delivery

*Generated from the portolan catalog · commit `7 sources` · at 2026-09-05T03:58:04Z. Do not edit by hand.*

- **Context:** [Delivery](README.md)
- **Terms:** 13
- **Read from:** `examples/shop/delivery/core/GLOSSARY.md`

One meaning per word inside this context, as the glossary beside the code states it.

## Terms

- **Address** — Where a parcel is going, as the warehouse needs it. A value, copied from the order at dispatch and never refreshed: a parcel already on a van does not move because somebody edited their profile.
- **Awaiting payment** — Where every shipment starts. Nothing leaves the warehouse before the ledger says the money moved (ADR core.0002).
- **Dispatch** — Handing a planned shipment's parcels to the carrier, under a tracking code. The order is asked once more first; a cancelled order's shipment is written off instead.
- **Order** — What the shipment is for. Another context owns it, so it is an id here and a question asked over its contract. The table `packages` keeps a foreign key into it, knowingly (ADR core.0001).
- **Package** — The row a shipment is kept in. The table's word, not the domain's; the domain says shipment.
- **Parcel** — One box. A shipment is one or more of them, and each is scanned on its own, which is why a parcel is an entity: it is followed over time.
- **Released** — The money moved; the shipment may be planned onto a route and dispatched. Said by this service, not by the ledger.
- **Route** — One van, one day, in the order the stops are driven. The order of the stops is the route: changing it is planning a new one.
- **Scan** — One sighting of one parcel: where and when. Append-only; a wrong scan is followed by a right one, and the pair is the history. The first scan after dispatch moves the shipment; the rest do not.
- **Shipment** — What is being carried to one address for one order. The aggregate root; its status moves only the way its lifecycle table allows.
- **Stop** — One place a van stops and what it drops there. Carries a copy of the shipment's address, itself a copy of the order's.
- **Tracking code** — What the customer types into a carrier's site. The carrier owns the format; this service only refuses what obviously cannot be one. Also the whole credential for the tracking page.
- **Window** — When a van is expected somewhere, as the two ends of a promise to a person.
