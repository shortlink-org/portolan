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
import org.portolan.payments.ledger.domain.payment.DeclineReason;
import org.portolan.payments.ledger.domain.payment.Giveback;
import org.portolan.payments.ledger.domain.payment.Hold;
import org.portolan.payments.ledger.domain.payment.Payment;
import org.portolan.payments.ledger.domain.payment.PaymentGateway;
import org.portolan.payments.ledger.domain.payment.PaymentPublisher;
import org.portolan.payments.ledger.domain.payment.PaymentRepository;
import org.portolan.payments.ledger.domain.payment.PaymentStatus;
import org.portolan.payments.ledger.domain.payment.event.PaymentAuthorized;
import org.portolan.payments.ledger.domain.payment.vo.Money;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * A cancellation racing the hold: the trace the checkout model in
 * examples/scenarios/lean found, where OrderCancelled reached the ledger while
 * the gateway was holding, found nothing to give back, and the hold stayed on a
 * cancelled order (ledger.0005).
 */
class AuthorizePaymentTest {

    private final Clock clock = Clock.fixed(Instant.parse("2026-09-05T12:00:00Z"), ZoneOffset.UTC);
    private final Money amount = new Money(900, "EUR");

    @Test
    void aCancellationWhileTheGatewayHoldsHasTheHoldGivenBack() {
        var payments = new Memory();
        var orders = new StandingOrders();
        var gateway = new Gateway();
        var bus = new Recording();
        var voidPayment = new VoidPayment(payments, gateway);
        // the customer cancels while the gateway is holding, and the fact reaches the ledger first
        gateway.whileHolding = () -> {
            orders.cancelled = true;
            assertFalse(voidPayment.handle("o-1").released(), "nothing is on record to give back yet");
        };
        var authorize = new AuthorizePayment(payments, gateway, orders, bus, clock);

        var out = authorize.handle("o-1", "o-1", amount);

        assertFalse(out.authorized());
        assertEquals(DeclineReason.ORDER_CANCELLED, out.reason());
        assertEquals(PaymentStatus.VOIDED, payments.byId("o-1").orElseThrow().status());
        assertEquals(List.of("auth-1"), gateway.voided, "the hold is given back");
        assertTrue(bus.published.stream().noneMatch(PaymentAuthorized.class::isInstance), "nobody hears of a hold that is gone");
    }

    @Test
    void aCancellationAfterTheSaveFindsThePaymentAndGivesItBack() {
        var payments = new Memory();
        var orders = new StandingOrders();
        var gateway = new Gateway();
        var authorize = new AuthorizePayment(payments, gateway, orders, new Recording(), clock);

        assertTrue(authorize.handle("o-2", "o-2", amount).authorized());
        orders.cancelled = true;
        assertTrue(new VoidPayment(payments, gateway).handle("o-2").released());

        assertEquals(PaymentStatus.VOIDED, payments.byId("o-2").orElseThrow().status());
        assertEquals(List.of("auth-1"), gateway.voided);
    }

    @Test
    void askingAgainForAHoldGivenBackIsRefused() {
        var payments = new Memory();
        var orders = new StandingOrders();
        var gateway = new Gateway();
        gateway.whileHolding = () -> orders.cancelled = true;
        var authorize = new AuthorizePayment(payments, gateway, orders, new Recording(), clock);
        authorize.handle("o-3", "o-3", amount);

        var again = authorize.handle("o-3", "o-3", amount);

        assertFalse(again.authorized());
        assertEquals(DeclineReason.ORDER_CANCELLED, again.reason());
        assertEquals(1, gateway.holds, "the network is asked once");
    }

    private static final class StandingOrders implements Orders {
        boolean cancelled;

        @Override
        public Standing standing(String orderId) {
            return cancelled ? Standing.CANCELLED : Standing.LIVE;
        }
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
        Runnable whileHolding = () -> { };
        int holds;
        final List<String> voided = new ArrayList<>();

        @Override
        public Hold hold(String orderId, Money amount) {
            holds++;
            whileHolding.run();
            return Hold.held("auth-" + holds);
        }

        @Override
        public void capture(String authCode) {
            throw new UnsupportedOperationException();
        }

        @Override
        public void voidHold(String authCode) {
            voided.add(authCode);
        }

        @Override
        public Giveback refund(String authCode, Money amount) {
            throw new UnsupportedOperationException();
        }
    }

    private static final class Recording implements PaymentPublisher {
        final List<Object> published = new ArrayList<>();

        @Override
        public void publish(Object event) {
            published.add(event);
        }
    }
}
