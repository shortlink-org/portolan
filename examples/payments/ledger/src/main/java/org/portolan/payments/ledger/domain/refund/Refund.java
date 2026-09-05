package org.portolan.payments.ledger.domain.refund;

import java.time.Instant;

import org.jmolecules.ddd.annotation.AggregateRoot;
import org.jmolecules.ddd.annotation.Identity;
import org.portolan.payments.ledger.domain.payment.IllegalMove;
import org.portolan.payments.ledger.domain.payment.vo.Money;
import org.portolan.payments.ledger.domain.refund.event.RefundIssued;

/**
 * Money going back, against a payment that was captured.
 *
 * Its own aggregate rather than a method on the payment: a refund is asked for
 * by somebody else, at another time, for a reason of its own, and there may be
 * several against one payment. The status moves only the way
 * {@link RefundStatus#TRANSITIONS} allows.
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

    /** Rebuilds a refund the store already holds; no move is made and nothing is published. */
    public static Refund restore(String id, String paymentId, String orderId, Money amount, String reason, RefundStatus status, Instant settledAt) {
        Refund refund = new Refund(id, paymentId, orderId, amount, reason);
        refund.status = status;
        refund.settledAt = settledAt;
        return refund;
    }

    private void allow(RefundStatus next) {
        if (!RefundStatus.TRANSITIONS.get(status).contains(next)) {
            throw new IllegalMove(status.name(), next.name());
        }
    }

    /** The money is on its way back. */
    public RefundIssued issue(Instant at) {
        allow(RefundStatus.ISSUED);
        this.status = RefundStatus.ISSUED;
        this.settledAt = at;
        return new RefundIssued(id, paymentId, orderId, amount, reason, at);
    }

    /** The gateway would not take it back, and that is the end of this refund. */
    public void reject() {
        allow(RefundStatus.REJECTED);
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
