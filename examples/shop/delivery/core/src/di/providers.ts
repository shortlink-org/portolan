// The assembly. Every port a use case declares is bound here to what fills
// it, and this is the one place in the tree that knows both sides exist: the
// use case states its need as an interface of its own so that it does not
// import the infrastructure that satisfies it.
import { createGrpcTransport } from "@connectrpc/connect-node";
import type { Pool } from "pg";
import type { Orders } from "../application/shipment/usecases/dispatch/usecase.ts";
import type { RouteRepository } from "../domain/route/port.ts";
import type { ShipmentRepository } from "../domain/shipment/port.ts";
import { OrderClient } from "../infrastructure/oms/client.ts";
import { PostgresRoutes } from "../infrastructure/repository/route/postgres.ts";
import { PostgresShipments } from "../infrastructure/repository/shipment/postgres.ts";

/** Where the order service is; the dispatch use case cannot tell. */
export interface Peers {
  omsAddr: string;
}

export function provideOrders(peers: Peers): Orders {
  return new OrderClient(createGrpcTransport({ baseUrl: peers.omsAddr }));
}

/** The two stores over one database; the pool is the caller's, migrated by `pkg/migrate`. */
export function provideShipments(pool: Pool): ShipmentRepository {
  return new PostgresShipments(pool);
}

export function provideRoutes(pool: Pool): RouteRepository {
  return new PostgresRoutes(pool);
}
