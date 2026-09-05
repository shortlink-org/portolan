package org.portolan.payments.ledger.domain.payment;

/** The id names nothing here. A sentinel, not an entity: it holds no state of the aggregate. */
public final class NoSuchPayment extends RuntimeException {

    public NoSuchPayment(String paymentId) {
        super("no payment " + paymentId);
    }
}
