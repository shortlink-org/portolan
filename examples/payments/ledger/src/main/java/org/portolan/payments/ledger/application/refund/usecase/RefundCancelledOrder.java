package org.portolan.payments.ledger.application.refund.usecase;

import java.util.Optional;

import org.jmolecules.ddd.annotation.Service;
import org.portolan.payments.ledger.application.refund.usecase.dto.IssueOutput;
import org.portolan.payments.ledger.domain.payment.PaymentRepository;
import org.portolan.payments.ledger.domain.payment.PaymentStatus;
import org.portolan.payments.ledger.domain.refund.RefundRepository;
import org.portolan.payments.ledger.domain.refund.services.Refundable;

/**
 * Sends back what was captured for an order that was cancelled.
 *
 * A customer may cancel until the parcel moves (oms.0004), and the money moves
 * earlier, when delivery creates the shipment (core.0003): an order can be
 * cancelled with its payment already captured. A hold still standing is
 * {@code VoidPayment}'s; captured money comes back here, as one refund of
 * whatever is left of the capture. The refund's id is derived from the order,
 * so the fact arriving again answers from the record and nothing goes back
 * twice (ledger.0006).
 */
@Service
public class RefundCancelledOrder {

    private final PaymentRepository payments;
    private final RefundRepository refunds;
    private final IssueRefund issueRefund;

    public RefundCancelledOrder(PaymentRepository payments, RefundRepository refunds, IssueRefund issueRefund) {
        this.payments = payments;
        this.refunds = refunds;
        this.issueRefund = issueRefund;
    }

    /** The refund for the order's cancellation, or nothing when no captured money is left to send back. */
    public Optional<IssueOutput> handle(String orderId, String reason) {
        var captured = payments.byOrder(orderId).filter(p -> p.status() == PaymentStatus.CAPTURED);
        if (captured.isEmpty()) {
            return Optional.empty();
        }
        var payment = captured.get();
        String refundId = refundIdFor(orderId);
        var left = Refundable.remaining(payment.amount(), refunds.byPayment(payment.id()));
        if (refunds.byId(refundId).isEmpty() && left.amountMinor() == 0) {
            return Optional.empty();
        }
        return Optional.of(issueRefund.handle(refundId, payment.id(), left, "order cancelled: " + reason));
    }

    /** One refund per cancelled order. */
    public static String refundIdFor(String orderId) {
        return "order-cancelled-" + orderId;
    }
}
