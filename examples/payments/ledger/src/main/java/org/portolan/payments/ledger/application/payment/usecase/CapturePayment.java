package org.portolan.payments.ledger.application.payment.usecase;

import java.time.Clock;
import java.time.Instant;

import org.jmolecules.ddd.annotation.Service;
import org.portolan.payments.ledger.domain.payment.PaymentGateway;
import org.portolan.payments.ledger.domain.payment.PaymentRepository;
import org.portolan.payments.ledger.domain.payment.event.PaymentCaptured;
import org.portolan.payments.ledger.infrastructure.bus.Bus;

/**
 * Moves the money the gateway was holding, writes the pair of postings for it,
 * and says so on the bus.
 */
@Service
public class CapturePayment {

    private final PaymentRepository payments;
    private final PaymentGateway gateway;
    private final Bus bus;
    private final Clock clock;

    public CapturePayment(PaymentRepository payments, PaymentGateway gateway, Bus bus, Clock clock) {
        this.payments = payments;
        this.gateway = gateway;
        this.bus = bus;
        this.clock = clock;
    }

    public PaymentCaptured handle(String paymentId) {
        var payment = payments.byId(paymentId).orElseThrow();
        gateway.settle(payment.authCode());
        var captured = payment.capture(Instant.now(clock));
        payments.save(payment);
        bus.publish(captured);
        return captured;
    }
}
