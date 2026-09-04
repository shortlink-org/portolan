package org.portolan.payments.ledger.domain.payment.vo;

import org.jmolecules.ddd.annotation.ValueObject;

/**
 * An amount in the minor unit of a currency: 1250 GBP is £12.50.
 *
 * The ledger never rounds. Everything it holds is an integer of minor units,
 * and a currency is compared before amounts are added at all.
 */
@ValueObject
public record Money(long amountMinor, String currency) {

    public Money {
        if (currency == null || currency.length() != 3) {
            throw new IllegalArgumentException("a currency is three letters of ISO 4217");
        }
    }

    public Money plus(Money other) {
        if (!currency.equals(other.currency)) {
            throw new IllegalArgumentException("cannot add " + other.currency + " to " + currency);
        }
        return new Money(amountMinor + other.amountMinor, currency);
    }

    public Money negated() {
        return new Money(-amountMinor, currency);
    }
}
