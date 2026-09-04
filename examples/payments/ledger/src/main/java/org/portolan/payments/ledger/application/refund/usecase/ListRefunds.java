package org.portolan.payments.ledger.application.refund.usecase;

import java.util.List;

import org.jmolecules.ddd.annotation.Service;
import org.portolan.payments.ledger.domain.refund.Refund;
import org.portolan.payments.ledger.domain.refund.RefundRepository;

/** Every refund against one payment, newest first. */
@Service
public class ListRefunds {

    private final RefundRepository refunds;

    public ListRefunds(RefundRepository refunds) {
        this.refunds = refunds;
    }

    public List<Refund> handle(String paymentId) {
        return refunds.byPayment(paymentId);
    }
}
