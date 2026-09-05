package org.portolan.payments.ledger.application.payment.usecase;

/** What authorising needs of the order service, in this use case's words; the adapter over the generated client fills it. */
public interface Orders {

    boolean stands(String orderId);
}
