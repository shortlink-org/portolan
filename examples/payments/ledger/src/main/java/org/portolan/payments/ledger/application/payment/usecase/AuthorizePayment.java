package org.portolan.payments.ledger.application.payment.usecase;

import java.time.Clock;
import java.time.Instant;

import org.jmolecules.ddd.annotation.Service;
import org.portolan.payments.ledger.domain.payment.Payment;
import org.portolan.payments.ledger.domain.payment.PaymentGateway;
import org.portolan.payments.ledger.domain.payment.PaymentRepository;
import org.portolan.payments.ledger.domain.payment.event.PaymentAuthorized;
import org.portolan.payments.ledger.domain.payment.vo.Money;
import org.portolan.payments.ledger.infrastructure.bus.Bus;
import org.portolan.payments.ledger.infrastructure.oms.OrderClient;

/**
 * Asks the gateway to hold the money for an order, and records either that it
 * agreed or that it refused.
 */
@Service
public class AuthorizePayment {

    private final PaymentRepository payments;
    private final PaymentGateway gateway;
    private final OrderClient orders;
    private final Bus bus;
    private final Clock clock;

    public AuthorizePayment(PaymentRepository payments, PaymentGateway gateway, OrderClient orders, Bus bus, Clock clock) {
        this.payments = payments;
        this.gateway = gateway;
        this.orders = orders;
        this.bus = bus;
        this.clock = clock;
    }

    public PaymentAuthorized handle(String paymentId, String orderId, Money amount) {
        var order = orders.getOrder(orderId);
        var payment = new Payment(paymentId, orderId, amount, 1, Instant.now(clock));
        String authCode = gateway.reserve(orderId, amount.amountMinor(), amount.currency());

        if (authCode.isEmpty()) {
            var declined = payment.decline("the gateway refused the card");
            payments.save(payment);
            bus.publish(declined);
            return null;
        }

        var authorized = payment.authorize(authCode, Instant.now(clock));
        payments.save(payment);
        bus.publish(authorized);
        return authorized;
    }
}
