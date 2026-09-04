// The assembly. Every port a use case declares is bound here to what fills
// it, and this is the one place in the tree that knows both sides exist: the
// use case states its need as an interface of its own so that it does not
// import the infrastructure that satisfies it.
import { createGrpcTransport } from "@connectrpc/connect-node";
import type { Orders } from "../application/shipment/usecases/dispatch/usecase.ts";
import { OrderClient } from "../infrastructure/oms/client.ts";

/** Where the order service is; the dispatch use case cannot tell. */
export interface Peers {
  omsAddr: string;
}

export function provideOrders(peers: Peers): Orders {
  return new OrderClient(createGrpcTransport({ baseUrl: peers.omsAddr }));
}
