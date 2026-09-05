package org.portolan.payments.ledger.domain.payment.event;

import java.time.Instant;

import org.jmolecules.event.annotation.DomainEvent;
import org.portolan.payments.ledger.domain.payment.vo.Money;

/**
 * The money moved. Whoever is owed something for this order - the invoice, the
 * warehouse - waits for this one and nothing earlier.
 */
@DomainEvent
public record PaymentCaptured(String paymentId, String orderId, Money amount, Instant occurredAt) {

    public static final String NAME = "ledger.PaymentCaptured";
    public static final String CHANNEL = "payments.ledger.payment";
}
