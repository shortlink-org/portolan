package org.portolan.payments.ledger.infrastructure.oms;

import org.jmolecules.architecture.hexagonal.SecondaryAdapter;
import org.portolan.payments.ledger.infrastructure.oms.gen.OrderServiceGrpc;

/**
 * The order service, as the ledger calls it. The stub is generated from the
 * contract vendored beside this file, so the call is recorded under the id the
 * callee's own extractor gives it.
 */
@SecondaryAdapter
public class OrderClient {

    private final OrderServiceGrpc.OrderServiceBlockingStub stub;

    public OrderClient(OrderServiceGrpc.OrderServiceBlockingStub stub) {
        this.stub = stub;
    }

    /** Asks the order service what the order says about itself. */
    public GetOrderResponse getOrder(String orderId) {
        return stub.getOrder(GetOrderRequest.newBuilder().setOrderId(orderId).build());
    }
}
