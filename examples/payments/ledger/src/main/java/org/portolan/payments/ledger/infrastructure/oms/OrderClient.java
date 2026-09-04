package org.portolan.payments.ledger.infrastructure.oms;

import org.jmolecules.architecture.hexagonal.SecondaryAdapter;

import org.portolan.payments.ledger.infrastructure.oms.gen.GetOrderRequest;
import org.portolan.payments.ledger.infrastructure.oms.gen.GetOrderResponse;
import org.portolan.payments.ledger.infrastructure.oms.gen.OrderServiceGrpc;

/**
 * The order service, as the ledger calls it.
 *
 * The stub is generated from the copy of shop.v1 vendored beside this file, so
 * the call is recorded under the id the order service's own extractor gives it.
 */
@SecondaryAdapter
public class OrderClient {

    private final OrderServiceGrpc.OrderServiceBlockingStub stub;

    public OrderClient(OrderServiceGrpc.OrderServiceBlockingStub stub) {
        this.stub = stub;
    }

    /** What the order says about itself: its state, and what it comes to. */
    public GetOrderResponse getOrder(String orderId) {
        return stub.getOrder(GetOrderRequest.newBuilder().setOrderId(orderId).build());
    }
}
