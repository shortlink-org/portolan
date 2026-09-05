package org.portolan.payments.ledger.application.refund.usecase.dto;

/** Whether the money is on its way back. A refusal by the gateway is recorded and answered as false. */
public record IssueOutput(String refundId, boolean issued) {
}
