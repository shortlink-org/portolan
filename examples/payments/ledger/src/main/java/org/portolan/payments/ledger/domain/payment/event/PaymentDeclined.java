package org.portolan.payments.ledger.domain.payment.event;

import java.time.Instant;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PastOrPresent;

import org.jmolecules.event.annotation.DomainEvent;
import org.portolan.payments.ledger.domain.payment.DeclineReason;

/** The money was not held, and the reason is one of a closed set a consumer can switch on. */
@DomainEvent
public record PaymentDeclined(
        @NotBlank String paymentId,
        @NotBlank String orderId,
        @NotNull DeclineReason reason,
        @NotNull @PastOrPresent Instant occurredAt) {

    public static final String NAME = "ledger.PaymentDeclined";
    public static final String CHANNEL = "payments.ledger.payment";
}
