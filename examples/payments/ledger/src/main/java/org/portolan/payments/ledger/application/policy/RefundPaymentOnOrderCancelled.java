package org.portolan.payments.ledger.application.policy;

import org.portolan.payments.ledger.application.oms.OrderCancelled;
import org.portolan.payments.ledger.application.refund.usecase.RefundCancelledOrder;
import org.springframework.context.event.EventListener;

/**
 * Sends captured money back once the order it was captured for is gone.
 *
 * Beside {@link VoidPaymentOnOrderCancelled} on the same fact, and never in its
 * way: that one gives back a hold, this one a capture, and a payment is one or
 * the other. It calls a use case and decides nothing itself (ledger.0006).
 */
public class RefundPaymentOnOrderCancelled {

    private final RefundCancelledOrder refundCancelledOrder;

    public RefundPaymentOnOrderCancelled(RefundCancelledOrder refundCancelledOrder) {
        this.refundCancelledOrder = refundCancelledOrder;
    }

    @EventListener
    public void on(OrderCancelled event) {
        refundCancelledOrder.handle(event.orderId(), event.reason());
    }
}
