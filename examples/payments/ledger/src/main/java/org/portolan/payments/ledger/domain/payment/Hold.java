package org.portolan.payments.ledger.domain.payment;

import org.jmolecules.ddd.annotation.ValueObject;

/**
 * What the gateway answers when asked to hold money: it did, with the code
 * that names the hold, or it refused, with a reason this service can act on.
 *
 * Unreachable is neither. A gateway that did not answer has not refused, and
 * the port says so by throwing {@link GatewayUnavailable} rather than by
 * returning something that looks like a decision.
 */
@ValueObject
public record Hold(boolean held, String authCode, DeclineReason refusal) {

    /** The money is held; the code is the gateway's handle on it and stays inside this service. */
    public static Hold held(String authCode) {
        return new Hold(true, authCode, null);
    }

    /** The gateway would not. */
    public static Hold refused(DeclineReason reason) {
        return new Hold(false, null, reason);
    }
}
