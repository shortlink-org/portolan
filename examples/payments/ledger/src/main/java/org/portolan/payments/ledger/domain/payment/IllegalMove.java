package org.portolan.payments.ledger.domain.payment;

/**
 * A command asked for a move the lifecycle table does not allow: capture on a
 * declined payment, void on a captured one. The caller can act on it, so it
 * is one sentinel with both ends named.
 */
public final class IllegalMove extends RuntimeException {

    private final String from;
    private final String to;

    public IllegalMove(String from, String to) {
        super(from + " does not become " + to);
        this.from = from;
        this.to = to;
    }

    public String from() {
        return from;
    }

    public String to() {
        return to;
    }
}
