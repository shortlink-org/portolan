package org.portolan.payments.ledger.application.payment.usecase;

/** What authorising needs of a risk service, in this use case's words; an adapter with no contract fills it. */
public interface Risk {

    boolean allows(String orderId);
}
