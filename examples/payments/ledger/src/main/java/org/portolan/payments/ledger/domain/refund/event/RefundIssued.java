package org.portolan.payments.ledger.domain.refund.event;

import java.time.Instant;

import org.jmolecules.event.annotation.DomainEvent;
import org.portolan.payments.ledger.domain.payment.vo.Money;

/** Money went back to the customer, against a payment that had been captured. */
@DomainEvent
public record RefundIssued(String refundId, String paymentId, String orderId, Money amount, String reason, Instant occurredAt) {

    public static final String NAME = "ledger.RefundIssued";
    public static final String CHANNEL = "payments.ledger.refund";
}
