package org.portolan.payments.ledger.domain.payment.event;

import java.time.Instant;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PastOrPresent;

import org.jmolecules.event.annotation.DomainEvent;
import org.portolan.payments.ledger.domain.payment.vo.Money;

/**
 * The gateway agreed to hold the money. Nothing has moved yet.
 *
 * The authorisation code is not on it: it is the gateway's handle on the
 * hold, and whoever has it can capture or release the money. It stays on the
 * aggregate, inside this service.
 */
@DomainEvent
public record PaymentAuthorized(
        @NotBlank String paymentId,
        @NotBlank String orderId,
        @NotNull Money amount,
        @NotNull @PastOrPresent Instant occurredAt) {

    public static final String NAME = "ledger.PaymentAuthorized";
    public static final String CHANNEL = "payments.ledger.payment";
}
