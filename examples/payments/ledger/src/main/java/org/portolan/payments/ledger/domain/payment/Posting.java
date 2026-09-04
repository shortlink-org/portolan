package org.portolan.payments.ledger.domain.payment;

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
    private final String writtenAt;

    public Posting(String account, Money amount, String writtenAt) {
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

    public String writtenAt() {
        return writtenAt;
    }
}
