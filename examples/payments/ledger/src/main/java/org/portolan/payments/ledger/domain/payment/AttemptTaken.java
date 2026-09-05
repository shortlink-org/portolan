package org.portolan.payments.ledger.domain.payment;

/**
 * Somebody else recorded this attempt at charging this order first. The
 * database holds the line (payments.0004: unique on order and attempt); the
 * answer is to read the order's payments again, not to try harder.
 */
public final class AttemptTaken extends RuntimeException {

    public AttemptTaken(String orderId, int attempt) {
        super("attempt " + attempt + " on order " + orderId + " is already recorded");
    }
}
