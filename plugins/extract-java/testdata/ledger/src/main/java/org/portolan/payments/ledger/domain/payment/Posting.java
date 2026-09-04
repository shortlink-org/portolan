package org.portolan.payments.ledger.domain.payment;

import org.jmolecules.ddd.annotation.Entity;
import org.portolan.payments.ledger.domain.payment.vo.Money;

/** One side of one movement: double entry means these come in balanced pairs. */
@Entity
public class Posting {

    private final String account;
    private final Money amount;
    private final String writtenAt;

    public Posting(String account, Money amount, String writtenAt) {
        this.account = account;
        this.amount = amount;
        this.writtenAt = writtenAt;
    }

    public Money amount() {
        return amount;
    }
}
