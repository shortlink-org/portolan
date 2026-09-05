package org.portolan.payments.ledger.application.payment.usecase;

import org.jmolecules.ddd.annotation.Service;
import org.jmolecules.ddd.types.Association;
import org.portolan.payments.ledger.domain.payment.Payment;
import org.portolan.payments.ledger.domain.payment.PaymentGateway;
import org.portolan.payments.ledger.domain.payment.PaymentRepository;
import org.portolan.payments.ledger.domain.payment.event.PaymentAuthorized;
import org.portolan.payments.ledger.domain.payment.vo.Money;
import org.portolan.payments.ledger.domain.payment.Publisher;

/** Reserves the money for an order, or records that the gateway refused. */
@Service
public class AuthorizePayment {

    private final PaymentRepository payments;
    private final PaymentGateway gateway;
    private final Orders orders;
    private final Risk risk;
    private final Publisher bus;

    public AuthorizePayment(PaymentRepository payments, PaymentGateway gateway, Orders orders, Risk risk, Publisher bus) {
        this.payments = payments;
        this.gateway = gateway;
        this.orders = orders;
        this.risk = risk;
        this.bus = bus;
    }

    public PaymentAuthorized handle(String paymentId, String orderId, Money amount) {
        var stands = orders.stands(orderId);
        var allowed = risk.allows(orderId);
        var payment = new Payment(paymentId, Association.forId(orderId), amount);
        String authCode = gateway.reserve(orderId, amount.amountMinor(), amount.currency());
        if (authCode.isEmpty()) {
            var declined = payment.decline("the gateway refused");
            payments.save(payment);
            bus.publish(declined);
            return null;
        }
        var authorized = payment.authorize(authCode);
        payments.save(payment);
        bus.publish(authorized);
        return authorized;
    }
}
