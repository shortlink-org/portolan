package org.portolan.payments.ledger.domain.payment.event;

import org.jmolecules.event.annotation.DomainEvent;
import org.portolan.payments.ledger.domain.payment.vo.Money;

/** The gateway agreed to hold the money. Nothing has moved yet. */
@DomainEvent
public record PaymentAuthorized(String paymentId, String orderId, Money amount, String authCode) {

    public static final String NAME = "ledger.PaymentAuthorized";
    public static final String CHANNEL = "payments.ledger.payment";
}
