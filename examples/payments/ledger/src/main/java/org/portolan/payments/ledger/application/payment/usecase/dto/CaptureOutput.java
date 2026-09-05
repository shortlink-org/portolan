package org.portolan.payments.ledger.application.payment.usecase.dto;

import java.time.Instant;

/** The money moved, and when. */
public record CaptureOutput(String paymentId, Instant capturedAt) {
}
