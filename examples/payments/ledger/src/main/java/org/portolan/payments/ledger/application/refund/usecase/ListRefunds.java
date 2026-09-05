package org.portolan.payments.ledger.application.refund.usecase;

import java.util.List;

import org.jmolecules.ddd.annotation.Service;
import org.portolan.payments.ledger.application.refund.usecase.dto.RefundItem;
import org.portolan.payments.ledger.domain.refund.Refund;
import org.portolan.payments.ledger.domain.refund.RefundRepository;

/**
 * Every refund against one payment, newest first.
 *
 * A query: it answers with items a caller may read and never lends the
 * aggregates. The list is as of the last commit; the read goes to the
 * refunds' own table.
 */
@Service
public class ListRefunds {

    private final RefundRepository refunds;

    public ListRefunds(RefundRepository refunds) {
        this.refunds = refunds;
    }

    public List<RefundItem> handle(String paymentId) {
        return refunds.byPayment(paymentId).stream().map(ListRefunds::item).toList();
    }

    private static RefundItem item(Refund refund) {
        return new RefundItem(
                refund.id(),
                refund.paymentId(),
                refund.orderId(),
                refund.amount(),
                refund.status(),
                refund.reason(),
                refund.settledAt());
    }
}
