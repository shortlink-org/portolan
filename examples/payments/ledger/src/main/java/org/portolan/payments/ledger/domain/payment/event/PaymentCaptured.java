package org.portolan.payments.ledger.domain.payment.event;

import java.time.Instant;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PastOrPresent;

import org.jmolecules.event.annotation.DomainEvent;
import org.portolan.payments.ledger.domain.payment.vo.Money;

/**
 * The money moved. Whoever is owed something for this order - the invoice, the
 * warehouse - waits for this one and nothing earlier.
 */
@DomainEvent
public record PaymentCaptured(
        @NotBlank String paymentId,
        @NotBlank String orderId,
        @NotNull Money amount,
        @NotNull @PastOrPresent Instant occurredAt) {

    public static final String NAME = "ledger.PaymentCaptured";
    public static final String CHANNEL = "payments.ledger.payment";
}
