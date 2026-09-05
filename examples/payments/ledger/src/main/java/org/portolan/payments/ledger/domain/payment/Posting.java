package org.portolan.payments.ledger.domain.payment;

import java.time.Instant;

import org.jmolecules.ddd.annotation.Entity;
import org.portolan.payments.ledger.domain.payment.vo.Money;

/**
 * One side of one movement of money.
 *
 * Double entry means these come in balanced pairs and are never updated: a
 * correction is another pair, not an edit of this one.
 */
@Entity
public final class Posting {

    private final String account;
    private final Money amount;
    private final Instant writtenAt;

    public Posting(String account, Money amount, Instant writtenAt) {
        this.account = account;
        this.amount = amount;
        this.writtenAt = writtenAt;
    }

    public String account() {
        return account;
    }

    public Money amount() {
        return amount;
    }

    public Instant writtenAt() {
        return writtenAt;
    }
}
