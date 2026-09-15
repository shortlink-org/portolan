package org.portolan.payments.ledger.application.payment.usecase;

import java.time.Clock;
import java.time.Instant;

import org.jmolecules.ddd.annotation.Service;
import org.portolan.payments.ledger.application.payment.usecase.dto.AuthorizeOutput;
import org.portolan.payments.ledger.domain.payment.DeclineReason;
import org.portolan.payments.ledger.domain.payment.Hold;
import org.portolan.payments.ledger.domain.payment.Payment;
import org.portolan.payments.ledger.domain.payment.PaymentGateway;
import org.portolan.payments.ledger.domain.payment.PaymentRepository;
import org.portolan.payments.ledger.domain.payment.PaymentPublisher;
import org.portolan.payments.ledger.domain.payment.vo.Money;

/**
 * Asks the gateway to hold the money for an order, and records either that it
 * agreed or that it refused.
 *
 * The order of steps is the rule. The same id asked twice answers from the
 * record rather than asking the gateway again. A cancelled order is declined
 * without asking the network: there is nothing to hold money for. Only then
 * is the gateway asked, and only its answer is recorded; a gateway that did
 * not answer leaves no row and no event (ADR ledger.0001).
 *
 * A hold is recorded before the order is asked about again. A cancellation
 * that arrived while the gateway was holding found no payment to give back;
 * asked after the save, the order says so and the hold is given back here.
 * A cancellation from the save on finds the payment and gives it back itself
 * (ADR ledger.0005).
 */
@Service
public class AuthorizePayment {

    private final PaymentRepository payments;
    private final PaymentGateway gateway;
    private final Orders orders;
    private final PaymentPublisher publisher;
    private final Clock clock;

    public AuthorizePayment(PaymentRepository payments, PaymentGateway gateway, Orders orders, PaymentPublisher publisher, Clock clock) {
        this.payments = payments;
        this.gateway = gateway;
        this.orders = orders;
        this.publisher = publisher;
        this.clock = clock;
    }

    public AuthorizeOutput handle(String paymentId, String orderId, Money amount) {
        var already = payments.byId(paymentId);
        if (already.isPresent()) {
            return outcomeOf(already.get());
        }

        int attempt = payments.byOrder(orderId).map(p -> p.attempt() + 1).orElse(1);
        Instant now = Instant.now(clock);
        var payment = new Payment(paymentId, orderId, amount, attempt, now);

        if (orders.standing(orderId) == Orders.Standing.CANCELLED) {
            var declined = payment.decline(DeclineReason.ORDER_CANCELLED, now);
            payments.save(payment);
            publisher.publish(declined);
            return AuthorizeOutput.refused(paymentId, DeclineReason.ORDER_CANCELLED);
        }

        // GatewayUnavailable passes through here untouched: not a verdict.
        Hold hold = gateway.hold(orderId, amount);
        if (!hold.held()) {
            var declined = payment.decline(hold.refusal(), now);
            payments.save(payment);
            publisher.publish(declined);
            return AuthorizeOutput.refused(paymentId, hold.refusal());
        }
        var authorized = payment.authorize(hold.authCode(), now);
        payments.save(payment);
        if (orders.standing(orderId) == Orders.Standing.CANCELLED) {
            payment.voidAuthorization();
            gateway.voidHold(hold.authCode());
            payments.save(payment);
            return AuthorizeOutput.refused(paymentId, DeclineReason.ORDER_CANCELLED);
        }
        publisher.publish(authorized);
        return AuthorizeOutput.held(paymentId);
    }

    /** The answer a payment already on record gives, so a retry is a read. */
    private static AuthorizeOutput outcomeOf(Payment payment) {
        return switch (payment.status()) {
            case DECLINED -> AuthorizeOutput.refused(payment.id(), DeclineReason.CARD_REFUSED);
            // a hold is given back only for a cancelled order
            case VOIDED -> AuthorizeOutput.refused(payment.id(), DeclineReason.ORDER_CANCELLED);
            case PENDING, AUTHORIZED, CAPTURED -> AuthorizeOutput.held(payment.id());
        };
    }
}
