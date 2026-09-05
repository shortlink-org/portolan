package org.portolan.payments.ledger.application.policy;

import org.portolan.payments.ledger.application.payment.usecase.VoidPayment;
import org.portolan.payments.ledger.application.oms.OrderCancelled;
import org.springframework.context.event.EventListener;

/**
 * Gives back what was held once the order it was held for is gone.
 *
 * Hangs off the fact, not off a call: however the order comes to be cancelled,
 * the same event says so and this behaviour comes with it. The event arrives
 * from another service over the bus and is republished in process by the
 * adapter that reads it (ADR ledger.0002); this listener does not know that.
 * It calls a use case and decides nothing itself: what counts as "held" and
 * what to do when nothing is are the use case's rules.
 */
public class VoidPaymentOnOrderCancelled {

    private final VoidPayment voidPayment;

    public VoidPaymentOnOrderCancelled(VoidPayment voidPayment) {
        this.voidPayment = voidPayment;
    }

    @EventListener
    public void on(OrderCancelled event) {
        voidPayment.handle(event.orderId());
    }
}
