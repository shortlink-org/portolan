package org.portolan.payments.ledger.application.payment.usecase;

import org.jmolecules.ddd.annotation.Service;
import org.portolan.payments.ledger.domain.payment.PaymentGateway;
import org.portolan.payments.ledger.domain.payment.PaymentRepository;
import org.portolan.payments.ledger.domain.payment.event.PaymentCaptured;
import org.portolan.payments.ledger.infrastructure.bus.Bus;

/** Moves the money the gateway was holding, and says so on the bus. */
@Service
public class CapturePayment {

    private final PaymentRepository payments;
    private final PaymentGateway gateway;
    private final Bus bus;

    public CapturePayment(PaymentRepository payments, PaymentGateway gateway, Bus bus) {
        this.payments = payments;
        this.gateway = gateway;
        this.bus = bus;
    }

    public PaymentCaptured handle(String paymentId, String capturedAt, String authCode) {
        var payment = payments.byId(paymentId).orElseThrow();
        gateway.settle(authCode);
        var captured = payment.capture(capturedAt);
        payments.save(payment);
        bus.publish(captured);
        return captured;
    }
}
