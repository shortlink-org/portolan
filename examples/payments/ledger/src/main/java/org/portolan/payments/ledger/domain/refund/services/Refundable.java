package org.portolan.payments.ledger.domain.refund.services;

import java.util.List;

import org.portolan.payments.ledger.domain.payment.vo.Money;
import org.portolan.payments.ledger.domain.refund.Refund;
import org.portolan.payments.ledger.domain.refund.RefundStatus;

/**
 * How much of a capture is still there to give back: the amount captured
 * less every refund already issued against it. Pure: it is handed the sums
 * and the refunds, and loading them is the caller's job.
 */
public final class Refundable {

    private Refundable() {}

    public static Money remaining(Money captured, List<Refund> refunds) {
        Money back = new Money(0, captured.currency());
        for (Refund refund : refunds) {
            if (refund.status() == RefundStatus.ISSUED) {
                back = back.plus(refund.amount());
            }
        }
        return new Money(captured.amountMinor() - back.amountMinor(), captured.currency());
    }
}
