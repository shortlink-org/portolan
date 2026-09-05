package org.portolan.payments.ledger.infrastructure.oms;

import org.jmolecules.architecture.hexagonal.SecondaryAdapter;
import org.portolan.payments.ledger.application.payment.usecase.Orders;
import org.portolan.payments.ledger.infrastructure.oms.gen.GetOrderRequest;
import org.portolan.payments.ledger.infrastructure.oms.gen.OrderServiceGrpc;

/**
 * The order service, as the ledger asks it: does the order still stand.
 *
 * The one package that knows both sides - the port the use case declared and
 * the stub generated from the copy of shop.v1 vendored beside this file, so
 * the call is recorded under the id the order service's own extractor gives
 * it. The contract's enum is read here and nowhere else.
 */
@SecondaryAdapter
public class OrderClient implements Orders {

    private final OrderServiceGrpc.OrderServiceBlockingStub stub;

    public OrderClient(OrderServiceGrpc.OrderServiceBlockingStub stub) {
        this.stub = stub;
    }

    /** A status this service does not know is an error, not a default: the contract changed, and guessing which way is how a cancelled order gets charged. */
    @Override
    public Standing standing(String orderId) {
        var answer = stub.getOrder(GetOrderRequest.newBuilder().setOrderId(orderId).build());
        if (!answer.hasOrder()) {
            throw new IllegalStateException("order " + orderId + ": the service answered with no order");
        }
        return switch (answer.getOrder().getStatus()) {
            case ORDER_STATUS_PLACED, ORDER_STATUS_CONFIRMED -> Standing.LIVE;
            case ORDER_STATUS_CANCELLED -> Standing.CANCELLED;
            default -> throw new IllegalStateException("order " + orderId + ": status " + answer.getOrder().getStatus() + " is not one this service knows");
        };
    }
}
