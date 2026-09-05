package org.portolan.payments.ledger.application.payment.usecase.dto;

import org.portolan.payments.ledger.domain.payment.DeclineReason;

/**
 * What the caller learns from asking for a hold: whether the money is held,
 * and if not, why. Never the authorisation code - that is the gateway's
 * handle on the money and leaves this service for nobody.
 */
public record AuthorizeOutput(String paymentId, boolean authorized, DeclineReason reason) {

    public static AuthorizeOutput held(String paymentId) {
        return new AuthorizeOutput(paymentId, true, null);
    }

    public static AuthorizeOutput refused(String paymentId, DeclineReason reason) {
        return new AuthorizeOutput(paymentId, false, reason);
    }
}
