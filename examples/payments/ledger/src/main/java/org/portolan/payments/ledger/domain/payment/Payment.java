package org.portolan.payments.ledger.domain.payment;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

import org.jmolecules.ddd.annotation.AggregateRoot;
import org.jmolecules.ddd.annotation.Identity;
import org.portolan.payments.ledger.domain.payment.event.PaymentAuthorized;
import org.portolan.payments.ledger.domain.payment.event.PaymentCaptured;
import org.portolan.payments.ledger.domain.payment.event.PaymentDeclined;
import org.portolan.payments.ledger.domain.payment.vo.Money;

/**
 * What one order owes, and everything that has happened to that money.
 *
 * Nothing here is updated in place except the status, and the status only ever
 * moves the way {@link PaymentStatus#TRANSITIONS} allows. A movement of money
 * is a pair of postings appended to the journal; the balance is what the pairs
 * add up to, never a column somebody writes.
 */
@AggregateRoot
public final class Payment {

    @Identity
    private final String id;

    /** The order this payment is for. Another context owns it, so this is its id and not its shape. */
    private final String orderId;

    private final Money amount;

    /** Which try at charging this order it is. payments.0004 keys the row on it. */
    private final int attempt;

    private final Instant createdAt;
    private final List<Posting> postings = new ArrayList<>();
    private PaymentStatus status = PaymentStatus.PENDING;
    private String authCode;

    public Payment(String id, String orderId, Money amount, int attempt, Instant createdAt) {
        this.id = id;
        this.orderId = orderId;
        this.amount = amount;
        this.attempt = attempt;
        this.createdAt = createdAt;
    }

    /** Rebuilds a payment the store already holds; no move is made and nothing is published. */
    public static Payment restore(String id, String orderId, Money amount, int attempt, Instant createdAt, PaymentStatus status, String authCode, List<Posting> postings) {
        Payment payment = new Payment(id, orderId, amount, attempt, createdAt);
        payment.status = status;
        payment.authCode = authCode;
        payment.postings.addAll(postings);
        return payment;
    }

    /** Records that the gateway is holding the money. */
    public PaymentAuthorized authorize(String authCode, Instant at) {
        this.authCode = authCode;
        this.status = PaymentStatus.AUTHORIZED;
        return new PaymentAuthorized(id, orderId, amount, authCode);
    }

    /**
     * Moves what was held, and writes the pair of postings that says so: the
     * customer owes less, the merchant is owed more, and the two sum to zero.
     */
    public PaymentCaptured capture(Instant at) {
        postings.add(new Posting("customer", amount.negated(), at.toString()));
        postings.add(new Posting("merchant", amount, at.toString()));
        this.status = PaymentStatus.CAPTURED;
        return new PaymentCaptured(id, orderId, amount, at.toString());
    }

    /** Ends the payment before any money moved. */
    public PaymentDeclined decline(String reason) {
        this.status = PaymentStatus.DECLINED;
        return new PaymentDeclined(id, orderId, reason);
    }

    /** Gives back what was held, once nobody is going to be charged for it. */
    public void voidAuthorization() {
        this.status = PaymentStatus.VOIDED;
    }

    public String id() {
        return id;
    }

    public String orderId() {
        return orderId;
    }

    public Money amount() {
        return amount;
    }

    public PaymentStatus status() {
        return status;
    }

    public String authCode() {
        return authCode;
    }

    public int attempt() {
        return attempt;
    }

    public Instant createdAt() {
        return createdAt;
    }

    public List<Posting> postings() {
        return List.copyOf(postings);
    }
}
