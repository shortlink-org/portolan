package org.portolan.payments.ledger.application.refund.usecase;

import java.time.Clock;
import java.time.Instant;

import org.jmolecules.ddd.annotation.Service;
import org.portolan.payments.ledger.application.refund.usecase.dto.IssueOutput;
import org.portolan.payments.ledger.domain.payment.Giveback;
import org.portolan.payments.ledger.domain.payment.NoSuchPayment;
import org.portolan.payments.ledger.domain.payment.PaymentGateway;
import org.portolan.payments.ledger.domain.payment.PaymentRepository;
import org.portolan.payments.ledger.domain.payment.PaymentStatus;
import org.portolan.payments.ledger.domain.payment.vo.Money;
import org.portolan.payments.ledger.domain.refund.NotRefundable;
import org.portolan.payments.ledger.domain.refund.RefundPublisher;
import org.portolan.payments.ledger.domain.refund.Refund;
import org.portolan.payments.ledger.domain.refund.RefundRepository;
import org.portolan.payments.ledger.domain.refund.RefundStatus;
import org.portolan.payments.ledger.domain.refund.services.Refundable;

/**
 * Sends money back against a captured payment, in full or in part.
 *
 * The order of steps is the rule: the same refund asked twice answers from the
 * record; nothing goes back against money that was never captured; nothing
 * goes back beyond what is left of the capture after earlier refunds; and only
 * then is the gateway asked. Its refusal is recorded; its silence is not.
 */
@Service
public class IssueRefund {

    private final RefundRepository refunds;
    private final PaymentRepository payments;
    private final PaymentGateway gateway;
    private final RefundPublisher publisher;
    private final Clock clock;

    public IssueRefund(RefundRepository refunds, PaymentRepository payments, PaymentGateway gateway, RefundPublisher publisher, Clock clock) {
        this.refunds = refunds;
        this.payments = payments;
        this.gateway = gateway;
        this.publisher = publisher;
        this.clock = clock;
    }

    public IssueOutput handle(String refundId, String paymentId, Money amount, String reason) {
        var already = refunds.byId(refundId);
        if (already.isPresent()) {
            return new IssueOutput(refundId, already.get().status() == RefundStatus.ISSUED);
        }

        var payment = payments.byId(paymentId).orElseThrow(() -> new NoSuchPayment(paymentId));
        if (payment.status() != PaymentStatus.CAPTURED) {
            throw new NotRefundable(NotRefundable.Why.NOT_CAPTURED);
        }
        Money left = Refundable.remaining(payment.amount(), refunds.byPayment(paymentId));
        if (!left.currency().equals(amount.currency()) || left.amountMinor() < amount.amountMinor()) {
            throw new NotRefundable(NotRefundable.Why.EXCEEDS_BALANCE);
        }

        var refund = new Refund(refundId, paymentId, payment.orderId(), amount, reason);
        Giveback answer = gateway.refund(payment.authCode(), amount); // unavailable: nothing is saved
        if (!answer.sent()) {
            refund.reject();
            refunds.save(refund);
            return new IssueOutput(refundId, false);
        }
        var issued = refund.issue(Instant.now(clock));
        refunds.save(refund);
        publisher.publish(issued);
        return new IssueOutput(refundId, true);
    }
}
