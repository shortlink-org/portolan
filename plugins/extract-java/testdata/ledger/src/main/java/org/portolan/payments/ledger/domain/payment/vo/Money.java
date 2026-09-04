package org.portolan.payments.ledger.domain.payment.vo;

import org.jmolecules.ddd.annotation.ValueObject;

/** An amount in the minor unit of a currency: 1250 GBP is £12.50. */
@ValueObject
public record Money(long amountMinor, String currency) {

    public Money plus(Money other) {
        return new Money(amountMinor + other.amountMinor, currency);
    }
}
