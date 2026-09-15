package org.portolan.payments.ledger.application.refund.usecase;

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
import org.portolan.payments.ledger.domain.payment.PaymentRepository;
import org.portolan.payments.ledger.domain.refund.Refund;
import org.portolan.payments.ledger.domain.refund.RefundRepository;
import org.portolan.payments.ledger.domain.refund.event.RefundIssued;
import org.portolan.payments.ledger.domain.payment.vo.Money;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * An order cancelled after its money moved: the trace the checkout model in
 * examples/scenarios/lean found, where the void that follows the cancellation
 * found nothing held and the customer stayed charged (ledger.0006).
 */
class RefundCancelledOrderTest {

    private final Clock clock = Clock.fixed(Instant.parse("2026-09-05T12:00:00Z"), ZoneOffset.UTC);
    private final Payments payments = new Payments();
    private final Refunds refunds = new Refunds();
    private final Gateway gateway = new Gateway();
    private final List<Object> published = new ArrayList<>();
    private final RefundCancelledOrder refund = new RefundCancelledOrder(payments, refunds,
            new IssueRefund(refunds, payments, gateway, published::add, clock));

    private Payment captured(String orderId) {
        var payment = new Payment(orderId, orderId, new Money(900, "EUR"), 1, clock.instant());
        payment.authorize("auth-" + orderId, clock.instant());
        payment.capture(clock.instant());
        payments.save(payment);
        return payment;
    }

    @Test
    void capturedMoneyForACancelledOrderGoesBackInFull() {
        captured("o-1");

        var out = refund.handle("o-1", "customer asked").orElseThrow();

        assertTrue(out.issued());
        assertEquals(List.of(new Money(900, "EUR")), gateway.refunded);
        var issued = (RefundIssued) published.get(0);
        assertEquals("o-1", issued.orderId());
        assertEquals("order cancelled: customer asked", issued.reason());
    }

    @Test
    void theFactArrivingAgainSendsNothingBackTwice() {
        captured("o-2");

        refund.handle("o-2", "customer asked");
        var again = refund.handle("o-2", "customer asked").orElseThrow();

        assertTrue(again.issued());
        assertEquals(1, gateway.refunded.size());
        assertEquals(1, published.size());
    }

    @Test
    void onlyWhatIsLeftOfTheCaptureGoesBack() {
        var payment = captured("o-3");
        var earlier = new Refund("r-earlier", payment.id(), "o-3", new Money(300, "EUR"), "damaged box");
        earlier.issue(clock.instant());
        refunds.save(earlier);

        refund.handle("o-3", "customer asked");

        assertEquals(List.of(new Money(600, "EUR")), gateway.refunded);
    }

    @Test
    void aHoldOrNothingOnRecordIsNotThisPolicysToGiveBack() {
        var held = new Payment("o-4", "o-4", new Money(900, "EUR"), 1, clock.instant());
        held.authorize("auth-o-4", clock.instant());
        payments.save(held);

        assertEquals(Optional.empty(), refund.handle("o-4", "customer asked"));
        assertEquals(Optional.empty(), refund.handle("o-5", "customer asked"));
        assertEquals(List.of(), gateway.refunded);
    }

    private static final class Payments implements PaymentRepository {
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

    private static final class Refunds implements RefundRepository {
        private final Map<String, Refund> rows = new HashMap<>();

        @Override
        public Optional<Refund> byId(String id) {
            return Optional.ofNullable(rows.get(id));
        }

        @Override
        public List<Refund> byPayment(String paymentId) {
            return rows.values().stream().filter(r -> r.paymentId().equals(paymentId)).toList();
        }

        @Override
        public void save(Refund refund) {
            rows.put(refund.id(), refund);
        }
    }

    private static final class Gateway implements PaymentGateway {
        final List<Money> refunded = new ArrayList<>();

        @Override
        public Hold hold(String orderId, Money amount) {
            throw new UnsupportedOperationException();
        }

        @Override
        public void capture(String authCode) {
            throw new UnsupportedOperationException();
        }

        @Override
        public void voidHold(String authCode) {
            throw new UnsupportedOperationException();
        }

        @Override
        public Giveback refund(String authCode, Money amount) {
            refunded.add(amount);
            return new Giveback(true, "re-" + refunded.size());
        }
    }
}
