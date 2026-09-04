package org.portolan.payments.ledger.application.policy;

import org.springframework.modulith.events.ApplicationModuleListener;

import org.portolan.payments.ledger.domain.payment.PaymentGateway;
import org.portolan.payments.ledger.domain.payment.PaymentRepository;
import org.portolan.payments.ledger.infrastructure.oms.event.OrderCancelled;

/**
 * Gives back what was held once the order it was held for is gone.
 *
 * Nothing is refunded here: a payment that was never captured has no money to
 * send back, and one that was is the refund aggregate's business.
 */
public class VoidPaymentOnOrderCancelled {

    private final PaymentRepository payments;
    private final PaymentGateway gateway;

    public VoidPaymentOnOrderCancelled(PaymentRepository payments, PaymentGateway gateway) {
        this.payments = payments;
        this.gateway = gateway;
    }

    @ApplicationModuleListener
    public void on(OrderCancelled event) {
        var payment = payments.byOrder(event.orderId()).orElseThrow();
        gateway.release(payment.authCode());
        payment.voidAuthorization();
        payments.save(payment);
    }
}
