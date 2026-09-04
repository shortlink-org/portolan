# Shipment tracking
owner: delivery

Reconstructed from production traces over a 24 hour window: the tracking page,
the carrier's scan webhook, and what each scan code sets off. Two things only
the traces know about — a consumer no repository accounts for, and an
exception path whose reader emits no spans at all.

## Participants
- customer: actor
- carrier-api: external "carrier-api (external)"
- delivery.core: service
- shop.oms: service
- bus: broker
- analytics-sink: unknown "analytics-sink (unknown)"

## Steps
customer -> delivery.core: rpc TrackShipment [verified] @trace 9f2c1a../span 04 #d1
  > Storefront tracking page. 41k calls in the window, p95 180 ms.
delivery.core -> shop.oms: rpc shop.v1.Orders/GetOrder [verified] @trace 9f2c1a../span 06 #d2
  > Resolves the order reference shown beside the parcel. Present in 96% of the
  > traces; the rest are served from the tracking cache.
loop one iteration per carrier scan; 4 scans per shipment at p50 over the window #loop-scan
  carrier-api -> delivery.core: rpc POST /webhooks/carrier/scan [verified] @trace 7be40d../span 01 #d3
    > Signed with the carrier's shared secret. 1.3% of scans in the window are
    > retries after a 5xx, and the traces show the retry landing on the same
    > shipment without a second state change.
  delivery.core -> delivery.core: RecordScan [verified] @trace 7be40d../span 03 #d4
end

alt scan code DELIVERED #alt-scan
  delivery.core -> bus: event delivery.core.shipment.ShipmentDelivered [verified] @trace 7be40d../span 27 #d5
  par ShipmentDelivered fan-out #par-delivered
    bus -> shop.oms: event delivery.core.shipment.ShipmentDelivered [verified] @trace 7be40d../span 29 #d6
      > Closes the order and starts the 30-day refund window the refund flow
      > reads.
  and
    bus -> analytics-sink: event delivery.core.shipment.ShipmentDelivered [unresolved] @trace 7be40d../span 31 #d7
      > Seen in traces only, under client id `analytics-sink-2`. No subscription
      > registration exists in any indexed repository, so the owning team is
      > unknown and nobody can be told before this topic changes shape.
  end

else scan code EXCEPTION
  delivery.core -> delivery.core: openDeliveryException [verified] @trace 4c81f3../span 09 #d8
    > The trace ends here. Whatever reads the exception queue emits no spans, so
    > the catalog cannot say what happens to the parcel next.
  stop
else scan code IN_TRANSIT
  delivery.core -> delivery.core: updateEta [verified] @trace 7be40d../span 12 #d9
    > No event is published for an in-transit scan; the tracking page reads the
    > shipment directly. 83% of the scans in the window end here.
end
