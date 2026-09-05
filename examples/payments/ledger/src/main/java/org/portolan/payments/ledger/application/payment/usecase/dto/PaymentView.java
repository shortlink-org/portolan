package org.portolan.payments.ledger.application.payment.usecase.dto;

import java.time.Instant;

import org.portolan.payments.ledger.domain.payment.PaymentStatus;
import org.portolan.payments.ledger.domain.payment.vo.Money;

/**
 * What a caller may see of a payment: whose money, how much, where it is in
 * its life, and which try it was. Not the aggregate, and not the auth code -
 * that is the gateway's handle on the hold, and nothing outside this service
 * has a use for it that is not a mistake. The journal stays inside too: the
 * postings are the ledger's own record, and the status already says what
 * they add up to.
 */
public record PaymentView(
        String paymentId,
        String orderId,
        Money amount,
        PaymentStatus status,
        int attempt,
        Instant createdAt) {
}
