package org.portolan.payments.ledger.domain.payment.services;

import java.util.List;

import org.portolan.payments.ledger.domain.payment.Posting;
import org.portolan.payments.ledger.domain.payment.vo.Money;

/** A domain service: a decision over the journal, pure. It holds nothing, so it is not an entity. */
public final class Balance {

    private Balance() {}

    public static long of(List<Posting> postings) {
        long sum = 0;
        for (Posting posting : postings) {
            sum += posting.amount().amountMinor();
        }
        return sum;
    }
}
