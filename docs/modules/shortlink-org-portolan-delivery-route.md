# shortlink-org/portolan-delivery-route

*Generated from the portolan catalog · commit `8 sources` · at 2026-09-05T03:58:04Z. Do not edit by hand.*

- **Id:** `buf.build/shortlink-org/portolan-delivery-route`
- **Registry:** buf.build
- **Publisher:** [delivery.core](../delivery/core/README.md)
- **Source:** [`examples/shop/delivery/core/src/infrastructure/transport/grpc/route/proto`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/delivery/core/src/infrastructure/transport/grpc/route/proto)

## Packages

| Package |
| --- |
| `delivery.v1` |

## Files

| File |
| --- |
| [`delivery/v1/routes.proto`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/delivery/core/delivery/v1/routes.proto) |

## Used by

| Service | Access |
| --- | --- |
| [Delivery Core](../delivery/core/README.md) | publishes |

## Interfaces

### delivery.v1.RouteService

- **Source:** [`examples/shop/delivery/core/src/infrastructure/transport/grpc/route/proto/delivery/v1/routes.proto:6`](https://github.com/shortlink-org/portolan/blob/main/examples/shop/delivery/core/src/infrastructure/transport/grpc/route/proto/delivery/v1/routes.proto#L6)
- **Module:** [buf.build/shortlink-org/portolan-delivery-route](shortlink-org-portolan-delivery-route.md)

| Method | Request | Response | Doc |
| --- | --- | --- | --- |
| `CloseRoute` | `CloseRouteRequest` | `CloseRouteResponse` | End the day, whatever is left undone. |
| `GetRoute` | `GetRouteRequest` | `GetRouteResponse` | One route, in the order it is driven. |
| `PlanRoute` | `PlanRouteRequest` | `PlanRouteResponse` | Build a day out of the shipments waiting to go out. |
| `StartRoute` | `StartRouteRequest` | `StartRouteResponse` | The van is out. |

<a id="message-closerouterequest"></a>
<details><summary>CloseRouteRequest</summary>

| Field | Type |
| --- | --- |
| `route_id` | `string` |

</details>

<a id="message-closerouteresponse"></a>
<details><summary>CloseRouteResponse</summary>

| Field | Type |
| --- | --- |
| `route_id` | `string` |

</details>

<a id="message-getrouterequest"></a>
<details><summary>GetRouteRequest</summary>

| Field | Type |
| --- | --- |
| `route_id` | `string` |

</details>

<a id="message-getrouteresponse"></a>
<details><summary>GetRouteResponse</summary>

| Field | Type |
| --- | --- |
| `route_id` | `string` |
| `vehicle` | `string` |
| `status` | `string` |
| `stops` | `[]StopView` |

</details>

<a id="message-planrouterequest"></a>
<details><summary>PlanRouteRequest</summary>

| Field | Type |
| --- | --- |
| `vehicle` | `string` |
| `planned_for` | `string` |
| `shipment_ids` | `[]string` |

</details>

<a id="message-planrouteresponse"></a>
<details><summary>PlanRouteResponse</summary>

| Field | Type |
| --- | --- |
| `route_id` | `string` |
| `stops` | `int32` |

</details>

<a id="message-startrouterequest"></a>
<details><summary>StartRouteRequest</summary>

| Field | Type |
| --- | --- |
| `route_id` | `string` |

</details>

<a id="message-startrouteresponse"></a>
<details><summary>StartRouteResponse</summary>

| Field | Type |
| --- | --- |
| `route_id` | `string` |

</details>

<a id="message-stopview"></a>
<details><summary>StopView</summary>

| Field | Type |
| --- | --- |
| `seq` | `int32` |
| `shipment_id` | `string` |
| `address` | `string` |
| `done` | `bool` |

</details>
