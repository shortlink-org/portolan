package org.portolan.payments.ledger.domain.payment;

import org.jmolecules.ddd.annotation.ValueObject;

/**
 * What the gateway answers when asked to send money back: it did, under a
 * reference of its own, or it would not. Unreachable throws
 * {@link GatewayUnavailable}, as with a hold.
 */
@ValueObject
public record Giveback(boolean sent, String reference) {

    public static Giveback sent(String reference) {
        return new Giveback(true, reference);
    }

    public static Giveback refused() {
        return new Giveback(false, null);
    }
}
