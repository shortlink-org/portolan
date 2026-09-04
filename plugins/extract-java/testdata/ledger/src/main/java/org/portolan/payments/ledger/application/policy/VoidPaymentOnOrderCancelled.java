package org.portolan.payments.ledger.application.policy;

import org.springframework.modulith.events.ApplicationModuleListener;

import org.portolan.payments.ledger.domain.payment.PaymentRepository;
import org.portolan.payments.ledger.infrastructure.oms.event.OrderCancelled;

/** Gives back what was reserved once the order it was reserved for is gone. */
public class VoidPaymentOnOrderCancelled {

    private final PaymentRepository payments;

    public VoidPaymentOnOrderCancelled(PaymentRepository payments) {
        this.payments = payments;
    }

    @ApplicationModuleListener
    public void on(OrderCancelled event) {
        var payment = payments.byOrder(event.orderId()).orElseThrow();
        payment.voidAuthorization();
        payments.save(payment);
    }
}
