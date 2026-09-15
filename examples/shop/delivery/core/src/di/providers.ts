// The assembly. Every port a use case declares is bound here to what fills
// it, and this is the one place in the tree that knows both sides exist: the
// use case states its need as an interface of its own so that it does not
// import the infrastructure that satisfies it.
import { randomUUID } from "node:crypto";
import { createGrpcTransport } from "@connectrpc/connect-node";
import type { Pool } from "pg";
import { CreateShipmentOnOrderConfirmed } from "../application/policy/create-shipment-on-order-confirmed.ts";
import { ReleaseShipmentOnPaymentCaptured } from "../application/policy/release-shipment-on-payment-captured.ts";
import { type Payments, UseCase as CreateShipment } from "../application/shipment/usecases/create_shipment/usecase.ts";
import type { Orders } from "../application/shipment/usecases/dispatch/usecase.ts";
import { UseCase as ReleaseShipment } from "../application/shipment/usecases/release_shipment/usecase.ts";
import type { RouteRepository } from "../domain/route/port.ts";
import type { ShipmentRepository } from "../domain/shipment/port.ts";
import { LedgerClient } from "../infrastructure/ledger/client.ts";
import { OrderClient } from "../infrastructure/oms/client.ts";
import { PostgresRoutes } from "../infrastructure/repository/route/postgres.ts";
import { PostgresShipments } from "../infrastructure/repository/shipment/postgres.ts";

/** Where the order service and the ledger are; the use cases cannot tell. */
export interface Peers {
  omsAddr: string;
  ledgerAddr: string;
}

export function provideOrders(peers: Peers): Orders {
  return new OrderClient(createGrpcTransport({ baseUrl: peers.omsAddr }));
}

export function providePayments(peers: Pick<Peers, "ledgerAddr">): Payments {
  return new LedgerClient(createGrpcTransport({ baseUrl: peers.ledgerAddr }));
}

/** The two stores over one database; the pool is the caller's, migrated by `pkg/migrate`. */
export function provideShipments(pool: Pool): ShipmentRepository {
  return new PostgresShipments(pool);
}

export function provideRoutes(pool: Pool): RouteRepository {
  return new PostgresRoutes(pool);
}

/** The reactions to other services' facts, each over the use case it runs. */
export interface Policies {
  createShipment: CreateShipmentOnOrderConfirmed;
  releaseShipment: ReleaseShipmentOnPaymentCaptured;
}

export function providePolicies(pool: Pool, peers: Pick<Peers, "ledgerAddr">): Policies {
  const shipments = provideShipments(pool);
  const now = () => new Date();

  return {
    createShipment: new CreateShipmentOnOrderConfirmed(new CreateShipment(shipments, providePayments(peers), now, randomUUID)),
    releaseShipment: new ReleaseShipmentOnPaymentCaptured(new ReleaseShipment(shipments, now)),
  };
}
