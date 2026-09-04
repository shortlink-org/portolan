package org.portolan.payments.ledger.domain.refund;

import java.time.Instant;

import org.jmolecules.ddd.annotation.AggregateRoot;
import org.jmolecules.ddd.annotation.Identity;
import org.portolan.payments.ledger.domain.payment.vo.Money;
import org.portolan.payments.ledger.domain.refund.event.RefundIssued;

/**
 * Money going back, against a payment that was captured.
 *
 * Its own aggregate rather than a method on the payment: a refund is asked for
 * by somebody else, at another time, for a reason of its own, and there may be
 * several against one payment.
 */
@AggregateRoot
public final class Refund {

    @Identity
    private final String id;

    private final String paymentId;
    private final String orderId;
    private final Money amount;
    private final String reason;
    private RefundStatus status = RefundStatus.REQUESTED;
    private Instant settledAt;

    public Refund(String id, String paymentId, String orderId, Money amount, String reason) {
        this.id = id;
        this.paymentId = paymentId;
        this.orderId = orderId;
        this.amount = amount;
        this.reason = reason;
    }

    /** The money is on its way back. */
    public RefundIssued issue(Instant at) {
        this.settledAt = at;
        this.status = RefundStatus.ISSUED;
        return new RefundIssued(id, paymentId, orderId, amount, reason);
    }

    /** The gateway would not take it back, and that is the end of this refund. */
    public void reject() {
        this.status = RefundStatus.REJECTED;
    }

    public String id() {
        return id;
    }

    public String paymentId() {
        return paymentId;
    }

    public Money amount() {
        return amount;
    }

    public RefundStatus status() {
        return status;
    }

    public String orderId() {
        return orderId;
    }

    public String reason() {
        return reason;
    }

    public Instant settledAt() {
        return settledAt;
    }
}
