package org.portolan.payments.ledger.domain.payment;

/**
 * The gateway did not answer. Not a decision: nothing is held, nothing is
 * declined, and nothing is written down about the money (ADR ledger.0001).
 */
public final class GatewayUnavailable extends RuntimeException {

    public GatewayUnavailable(String operation, Throwable cause) {
        super("gateway: " + operation + ": no answer", cause);
    }

    public GatewayUnavailable(String operation, String detail) {
        super("gateway: " + operation + ": " + detail);
    }
}
