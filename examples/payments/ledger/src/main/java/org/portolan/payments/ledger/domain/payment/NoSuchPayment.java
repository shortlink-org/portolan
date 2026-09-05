package org.portolan.payments.ledger.domain.payment;

/** The id names nothing here. The caller already knows the id, so saying so discloses nothing. */
public final class NoSuchPayment extends RuntimeException {

    public NoSuchPayment(String paymentId) {
        super("no payment " + paymentId);
    }
}
