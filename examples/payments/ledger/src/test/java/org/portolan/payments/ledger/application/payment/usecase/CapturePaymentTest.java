package org.portolan.payments.ledger.application.payment.usecase;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import org.junit.jupiter.api.Test;
import org.portolan.payments.ledger.domain.payment.Giveback;
import org.portolan.payments.ledger.domain.payment.Hold;
import org.portolan.payments.ledger.domain.payment.Payment;
import org.portolan.payments.ledger.domain.payment.PaymentGateway;
import org.portolan.payments.ledger.domain.payment.PaymentPublisher;
import org.portolan.payments.ledger.domain.payment.PaymentRepository;
import org.portolan.payments.ledger.domain.payment.PaymentStatus;
import org.portolan.payments.ledger.domain.payment.event.PaymentCaptured;
import org.portolan.payments.ledger.domain.payment.vo.Money;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

/**
 * The capture a caller repeats: the trace the checkout model in
 * examples/scenarios/lean found, where the event of a saved capture never left
 * and the shipment waited for it for good (ledger.0004).
 */
class CapturePaymentTest {

    private final Clock clock = Clock.fixed(Instant.parse("2026-09-05T12:00:00Z"), ZoneOffset.UTC);

    @Test
    void aCaptureWhoseEventDidNotLeaveIsSaidAgainWhenAskedAgain() {
        var payments = new Memory();
        var payment = new Payment("o-1", "o-1", new Money(900, "EUR"), 1, clock.instant());
        payment.authorize("auth-1", clock.instant());
        payments.save(payment);
        var gateway = new Gateway();
        var bus = new FailingOnce();
        var capture = new CapturePayment(payments, gateway, bus, clock);

        assertThrows(IllegalStateException.class, () -> capture.handle("o-1"));
        assertEquals(PaymentStatus.CAPTURED, payments.byId("o-1").orElseThrow().status(), "the capture is on record");
        assertEquals(List.of(), bus.published, "and its event did not leave");

        var out = capture.handle("o-1");
        assertEquals(1, gateway.captures, "the money moves once");
        assertEquals(1, bus.published.size(), "the repeated capture says it");
        var said = (PaymentCaptured) bus.published.get(0);
        assertEquals("o-1", said.paymentId());
        assertEquals("o-1", said.orderId());
        assertEquals(new Money(900, "EUR"), said.amount());
        assertEquals(out.capturedAt(), said.occurredAt(), "at the time of the first capture");
    }

    @Test
    void everyRepeatSaysTheSameFact() {
        var payments = new Memory();
        var payment = new Payment("o-2", "o-2", new Money(900, "EUR"), 1, clock.instant());
        payment.authorize("auth-2", clock.instant());
        payments.save(payment);
        var gateway = new Gateway();
        var bus = new Recording();
        var capture = new CapturePayment(payments, gateway, bus, clock);

        capture.handle("o-2");
        capture.handle("o-2");

        assertEquals(1, gateway.captures);
        assertEquals(2, bus.published.size());
        assertEquals(bus.published.get(0), bus.published.get(1));
    }

    private static final class Memory implements PaymentRepository {
        private final Map<String, Payment> rows = new HashMap<>();

        @Override
        public Optional<Payment> byId(String id) {
            return Optional.ofNullable(rows.get(id));
        }

        @Override
        public Optional<Payment> byOrder(String orderId) {
            return rows.values().stream().filter(p -> p.orderId().equals(orderId)).findFirst();
        }

        @Override
        public void save(Payment payment) {
            rows.put(payment.id(), payment);
        }
    }

    private static final class Gateway implements PaymentGateway {
        int captures;

        @Override
        public Hold hold(String orderId, Money amount) {
            throw new UnsupportedOperationException();
        }

        @Override
        public void capture(String authCode) {
            captures++;
        }

        @Override
        public void voidHold(String authCode) {
            throw new UnsupportedOperationException();
        }

        @Override
        public Giveback refund(String authCode, Money amount) {
            throw new UnsupportedOperationException();
        }
    }

    private static class Recording implements PaymentPublisher {
        final List<Object> published = new ArrayList<>();

        @Override
        public void publish(Object event) {
            published.add(event);
        }
    }

    /** A bus whose first publish fails the way {@code NatsBus} does: after the save, with a throw. */
    private static final class FailingOnce extends Recording {
        private boolean failed;

        @Override
        public void publish(Object event) {
            if (!failed) {
                failed = true;
                throw new IllegalStateException("ledger.PaymentCaptured did not leave: stream unavailable");
            }
            super.publish(event);
        }
    }
}
