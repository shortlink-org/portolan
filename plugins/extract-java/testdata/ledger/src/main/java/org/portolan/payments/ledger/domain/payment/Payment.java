package org.portolan.payments.ledger.domain.payment;

import java.util.ArrayList;
import java.util.List;

import org.jmolecules.ddd.annotation.AggregateRoot;
import org.jmolecules.ddd.annotation.Identity;
import org.jmolecules.ddd.types.Association;
import org.portolan.payments.ledger.domain.payment.event.PaymentAuthorized;
import org.portolan.payments.ledger.domain.payment.event.PaymentCaptured;
import org.portolan.payments.ledger.domain.payment.event.PaymentDeclined;
import org.portolan.payments.ledger.domain.payment.vo.Money;

/**
 * What one order owes and what has happened to that money.
 *
 * A payment is never updated in place: every movement is a pair of postings,
 * and the status only ever moves the way PaymentStatus.TRANSITIONS says.
 */
@AggregateRoot
public class Payment {

    @Identity
    private final String id;

    /** The order this payment is for; another context's aggregate, so a reference and not a field. */
    private final Association<Object, String> order;

    private final Money amount;
    private PaymentStatus status = PaymentStatus.PENDING;
    private String authCode;
    private final List<Posting> postings = new ArrayList<>();

    public Payment(String id, Association<Object, String> order, Money amount) {
        this.id = id;
        this.order = order;
        this.amount = amount;
    }

    /** Reserves the funds the gateway agreed to hold. */
    public PaymentAuthorized authorize(String authCode) {
        this.authCode = authCode;
        this.status = PaymentStatus.AUTHORIZED;
        return new PaymentAuthorized(id, order.getId(), amount, authCode);
    }

    /** Moves the reserved funds, and writes the pair of postings that says so. */
    public PaymentCaptured capture(String capturedAt) {
        postings.add(new Posting("customer", amount, capturedAt));
        postings.add(new Posting("merchant", amount, capturedAt));
        this.status = PaymentStatus.CAPTURED;
        return new PaymentCaptured(id, order.getId(), amount, capturedAt);
    }

    /** Ends the payment before any money moved. */
    public PaymentDeclined decline(String reason) {
        this.status = PaymentStatus.DECLINED;
        return new PaymentDeclined(id, order.getId(), reason);
    }

    /** Gives back what was reserved, once nobody is going to be charged for it. */
    public void voidAuthorization() {
        this.status = PaymentStatus.VOIDED;
    }

    public PaymentStatus status() {
        return status;
    }
}
