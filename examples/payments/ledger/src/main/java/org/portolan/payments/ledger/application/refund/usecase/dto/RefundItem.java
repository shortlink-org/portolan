package org.portolan.payments.ledger.application.refund.usecase.dto;

import java.time.Instant;

import org.portolan.payments.ledger.domain.payment.vo.Money;
import org.portolan.payments.ledger.domain.refund.RefundStatus;

/**
 * One refund as a list answers with it: against which payment and order,
 * how much, why, whether it went back and when. Not the aggregate; a caller
 * reading the list has nothing to issue or reject.
 */
public record RefundItem(
        String refundId,
        String paymentId,
        String orderId,
        Money amount,
        RefundStatus status,
        String reason,
        Instant settledAt) {
}
