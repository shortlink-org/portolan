package org.portolan.payments.ledger.application.refund.usecase;

import java.time.Clock;
import java.time.Instant;

import org.jmolecules.ddd.annotation.Service;
import org.portolan.payments.ledger.domain.payment.PaymentGateway;
import org.portolan.payments.ledger.domain.payment.PaymentRepository;
import org.portolan.payments.ledger.domain.payment.vo.Money;
import org.portolan.payments.ledger.domain.refund.Refund;
import org.portolan.payments.ledger.domain.refund.RefundRepository;
import org.portolan.payments.ledger.domain.refund.event.RefundIssued;
import org.portolan.payments.ledger.infrastructure.bus.Bus;

/** Sends money back against a captured payment, in full or in part. */
@Service
public class IssueRefund {

    private final RefundRepository refunds;
    private final PaymentRepository payments;
    private final PaymentGateway gateway;
    private final Bus bus;
    private final Clock clock;

    public IssueRefund(RefundRepository refunds, PaymentRepository payments, PaymentGateway gateway, Bus bus, Clock clock) {
        this.refunds = refunds;
        this.payments = payments;
        this.gateway = gateway;
        this.bus = bus;
        this.clock = clock;
    }

    public RefundIssued handle(String refundId, String paymentId, Money amount, String reason) {
        var payment = payments.byId(paymentId).orElseThrow();
        var refund = new Refund(refundId, paymentId, payment.orderId(), amount, reason);
        String reference = gateway.giveBack(payment.authCode(), amount.amountMinor());

        if (reference.isEmpty()) {
            refund.reject();
            refunds.save(refund);
            return null;
        }

        var issued = refund.issue(Instant.now(clock));
        refunds.save(refund);
        bus.publish(issued);
        return issued;
    }
}
