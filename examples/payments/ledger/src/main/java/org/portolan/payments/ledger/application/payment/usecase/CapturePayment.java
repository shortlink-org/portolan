package org.portolan.payments.ledger.application.payment.usecase;

import java.time.Clock;
import java.time.Instant;

import org.jmolecules.ddd.annotation.Service;
import org.portolan.payments.ledger.application.payment.usecase.dto.CaptureOutput;
import org.portolan.payments.ledger.domain.payment.NoSuchPayment;
import org.portolan.payments.ledger.domain.payment.PaymentGateway;
import org.portolan.payments.ledger.domain.payment.PaymentRepository;
import org.portolan.payments.ledger.domain.payment.PaymentStatus;
import org.portolan.payments.ledger.domain.payment.PaymentPublisher;

/**
 * Moves the money the gateway was holding, writes the pair of postings for it,
 * and says so on the bus.
 *
 * The aggregate is asked first, so a capture the lifecycle refuses never
 * reaches the network; a second capture of the same payment answers with the
 * first and moves nothing.
 */
@Service
public class CapturePayment {

    private final PaymentRepository payments;
    private final PaymentGateway gateway;
    private final PaymentPublisher publisher;
    private final Clock clock;

    public CapturePayment(PaymentRepository payments, PaymentGateway gateway, PaymentPublisher publisher, Clock clock) {
        this.payments = payments;
        this.gateway = gateway;
        this.publisher = publisher;
        this.clock = clock;
    }

    public CaptureOutput handle(String paymentId) {
        var payment = payments.byId(paymentId).orElseThrow(() -> new NoSuchPayment(paymentId));
        if (payment.status() == PaymentStatus.CAPTURED) {
            return new CaptureOutput(paymentId, payment.capturedAt().orElseThrow());
        }
        var captured = payment.capture(Instant.now(clock)); // IllegalMove before any money moves
        gateway.capture(payment.authCode());                 // unavailable: nothing is saved
        payments.save(payment);
        publisher.publish(captured);
        return new CaptureOutput(paymentId, captured.occurredAt());
    }
}
