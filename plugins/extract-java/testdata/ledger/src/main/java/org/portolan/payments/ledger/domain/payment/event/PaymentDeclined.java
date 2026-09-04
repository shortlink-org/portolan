package org.portolan.payments.ledger.domain.payment.event;

import org.jmolecules.event.annotation.DomainEvent;

/** The gateway refused, and it says why in its own words. */
@DomainEvent
public record PaymentDeclined(String paymentId, String orderId, String reason) {

    public static final String NAME = "ledger.PaymentDeclined";
    public static final String CHANNEL = "payments.ledger.payment";
}
