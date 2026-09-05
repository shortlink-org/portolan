package org.portolan.payments.ledger.application.oms;

/**
 * Another service's fact, in the shape this one needs to react to it: the
 * order is gone, and why. Declared here, beside the policy that listens,
 * rather than in infrastructure, so the policy imports nothing that knows
 * about a wire. The adapter that reads the bus translates into this and
 * republishes it in process (ADR ledger.0002). The manifest says which
 * aggregate it belongs to; without that line the policy names a type and the
 * step resolves to nothing.
 */
public record OrderCancelled(String orderId, String reason) {

    public static final String NAME = "oms.OrderCancelled";
}
