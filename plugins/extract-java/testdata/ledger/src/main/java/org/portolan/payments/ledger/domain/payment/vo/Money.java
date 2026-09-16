package org.portolan.payments.ledger.domain.payment.vo;

import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import org.jmolecules.ddd.annotation.ValueObject;

/** An amount in the minor unit of a currency: 1250 GBP is £12.50. */
@ValueObject
public record Money(@Positive long amountMinor, @Size(min = 3, max = 3) @Pattern(regexp = "^[A-Z]{3}$") String currency) {

    public Money plus(Money other) {
        return new Money(amountMinor + other.amountMinor, currency);
    }
}
