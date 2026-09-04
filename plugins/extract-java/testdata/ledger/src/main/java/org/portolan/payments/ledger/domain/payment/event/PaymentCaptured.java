package org.portolan.payments.ledger.domain.payment.event;

import org.jmolecules.event.annotation.DomainEvent;
import org.portolan.payments.ledger.domain.payment.vo.Money;

/** The reserved funds moved. This is the one every invoice waits for. */
@DomainEvent
public record PaymentCaptured(String paymentId, String orderId, Money amount, String capturedAt) {

    public static final String NAME = "ledger.PaymentCaptured";
    public static final String CHANNEL = "payments.ledger.payment";
}
