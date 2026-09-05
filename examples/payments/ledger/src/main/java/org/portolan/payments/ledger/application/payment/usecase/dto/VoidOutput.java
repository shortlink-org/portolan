package org.portolan.payments.ledger.application.payment.usecase.dto;

/** Whether a hold was released for the order. False is not a failure: there was nothing held, or it was already gone. */
public record VoidOutput(String orderId, boolean released) {
}
